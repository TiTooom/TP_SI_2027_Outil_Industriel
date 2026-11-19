const { test } = require('node:test');
const assert = require('node:assert');
const { decodeRaw, decodeValue, registerCount } = require('../src/services/modbusDecoder');

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
