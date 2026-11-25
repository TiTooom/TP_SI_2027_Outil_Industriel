const { test } = require('node:test');
const assert = require('node:assert');
const { decodeRaw, decodeValue, encodeValue, registerCount } = require('../src/services/modbusDecoder');

test('int16 and uint16 handle the sign bit', () => {
  assert.strictEqual(decodeRaw('int16', [0xffff]), -1);
  assert.strictEqual(decodeRaw('uint16', [0xffff]), 65535);
});

test('32-bit types read the high word first', () => {
  assert.strictEqual(decodeRaw('uint32', [0x0001, 0x0000]), 65536);
  assert.strictEqual(decodeRaw('int32', [0xffff, 0xfffe]), -2);
});

test('float32 decodes ABCD order (1.5 = 0x3FC00000)', () => {
  assert.strictEqual(decodeRaw('float32', [0x3fc0, 0x0000]), 1.5);
});

test('bool reads the first bit', () => {
  assert.strictEqual(decodeRaw('bool', [true]), 1);
  assert.strictEqual(decodeRaw('bool', [false]), 0);
});

test('value = raw * scale + offset', () => {
  assert.ok(Math.abs(decodeValue('int16', [235], 0.1, 5) - 28.5) < 1e-9);
});

test('NaN float32 and short data are errors', () => {
  assert.throws(() => decodeValue('float32', [0x7fc0, 0x0000]));
  assert.throws(() => decodeRaw('int32', [1]));
  assert.throws(() => registerCount('nope'));
});

// --- encodeValue : inverse de decodeValue -------------------------------------------------

test('encodeValue applies the inverse of scale and offset and rounds to the step', () => {
  assert.deepStrictEqual(encodeValue('int16', 25.3, 0.1, 0).registers, [253]); // 25.3 / 0.1 = 252.99999999999997
  assert.deepStrictEqual(encodeValue('int16', 28.5, 0.1, 5).registers, [235]);
  assert.strictEqual(encodeValue('int16', 25.34, 0.1, 0).value, 25.3, 'value is what the PLC will really hold');
});

test('encodeValue writes the two-complement for negative int16 and the high word first for 32 bits', () => {
  assert.deepStrictEqual(encodeValue('int16', -1).registers, [0xffff]);
  assert.deepStrictEqual(encodeValue('uint32', 65536).registers, [0x0001, 0x0000]);
  assert.deepStrictEqual(encodeValue('int32', -2).registers, [0xffff, 0xfffe]);
  assert.deepStrictEqual(encodeValue('float32', 1.5).registers, [0x3fc0, 0x0000]);
});

test('encodeValue round-trips with decodeValue', () => {
  for (const [type, value, scale, offset] of [['int16', -123, 1, 0], ['uint16', 6553.5, 0.1, 0], ['int32', -70000, 1, 0], ['float32', 12.25, 1, 0]]) {
    const { registers } = encodeValue(type, value, scale, offset);
    assert.ok(Math.abs(decodeValue(type, registers, scale, offset) - value) < 1e-6, `${type} ${value}`);
  }
});

test('encodeValue rejects out-of-range values with a message giving the allowed physical range', () => {
  const range = (fn) => { try { fn(); } catch (e) { return e; } return null; };
  const e = range(() => encodeValue('int16', 4000, 0.1, 0));
  assert.strictEqual(e.code, 'INVALID_VALUE');
  assert.strictEqual(e.message, 'Value out of range: must be between -3276.8 and 3276.7');
  assert.strictEqual(range(() => encodeValue('uint16', -1)).code, 'INVALID_VALUE');
  assert.strictEqual(range(() => encodeValue('uint16', 65535.6)).code, 'INVALID_VALUE'); // arrondi à 65536
  assert.strictEqual(range(() => encodeValue('uint16', 65535.4)), null);
  assert.strictEqual(range(() => encodeValue('uint32', 2 ** 32)).code, 'INVALID_VALUE');
  assert.strictEqual(range(() => encodeValue('float32', 1e39)).code, 'INVALID_VALUE');
  // échelle négative : les bornes physiques restent triées
  assert.strictEqual(range(() => encodeValue('int16', 99999, -1, 0)).message, 'Value out of range: must be between -32767 and 32768');
});

test('encodeValue refuses anything that is not a finite number for registers', () => {
  for (const bad of [NaN, Infinity, '12', null, undefined, true, {}]) {
    assert.strictEqual((() => { try { encodeValue('int16', bad); } catch (e) { return e.code; } return null; })(), 'INVALID_VALUE', String(bad));
  }
});

test('encodeValue for bool accepts true/false/1/0 only', () => {
  assert.deepStrictEqual(encodeValue('bool', true), { bit: true, value: 1 });
  assert.deepStrictEqual(encodeValue('bool', 0), { bit: false, value: 0 });
  for (const bad of [2, -1, 'true', null, undefined, 1.5]) {
    assert.throws(() => encodeValue('bool', bad), (e) => e.code === 'INVALID_VALUE', String(bad));
  }
});
