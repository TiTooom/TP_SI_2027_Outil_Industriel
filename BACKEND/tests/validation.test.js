const { test } = require('node:test');
const assert = require('node:assert');
const { validatePlc, isValidHost } = require('../src/validation/plc');
const { validateVariable } = require('../src/validation/variable');

test('PLC defaults are applied', () => {
  const { value } = validatePlc({ name: 'A', host: '10.0.0.5' });
  assert.deepStrictEqual(value, { name: 'A', host: '10.0.0.5', port: 502, unit_id: 1, enabled: true });
});

test('PLC host accepts IPv4 and DNS names only', () => {
  for (const ok of ['192.168.1.10', 'simulator', 'plc-1.factory.local']) assert.ok(isValidHost(ok), ok);
  for (const ko of ['999.1.1.1', '-bad.com', 'a_b', 'with space', '1.2.3']) assert.ok(!isValidHost(ko), ko);
});

test('PLC host denylist', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.1.2.3', '0.0.0.0', '169.254.0.1', '::1', '[::1]', 'db', 'backend', 'frontend']) {
    assert.strictEqual(validatePlc({ name: 'A', host }).error, 'host is not allowed', host);
  }
  for (const host of ['simulator', '10.0.0.1', '169.253.0.1', 'database']) assert.ok(!validatePlc({ name: 'A', host }).error, host);
});

test('PLC rejects bad fields', () => {
  assert.ok(validatePlc({ host: 'x' }).error);
  assert.ok(validatePlc({ name: 'A', host: 'x', port: 70000 }).error);
  assert.ok(validatePlc({ name: 'A', host: 'x', port: '502' }).error);
  assert.ok(validatePlc({ name: 'A', host: 'x', unit_id: 256 }).error);
  assert.ok(validatePlc({ name: 'A', host: 'x', enabled: 'yes' }).error);
  assert.ok(validatePlc([]).error);
});

const base = { plc_id: 1, name: 'T', register_type: 'holding', address: 0, data_type: 'int16', frequency_s: 2 };

test('variable defaults are applied', () => {
  const { value } = validateVariable(base);
  assert.strictEqual(value.scale, 1);
  assert.strictEqual(value.value_offset, 0);
  assert.strictEqual(value.unit, '');
  assert.strictEqual(value.enabled, true);
});

test('variable bool/register type coupling', () => {
  assert.ok(validateVariable({ ...base, register_type: 'coil', data_type: 'int16' }).error);
  assert.ok(validateVariable({ ...base, data_type: 'bool' }).error);
  assert.ok(!validateVariable({ ...base, register_type: 'discrete', data_type: 'bool' }).error);
});

test('variable rejects bad numbers', () => {
  assert.ok(validateVariable({ ...base, scale: 0 }).error);
  assert.ok(validateVariable({ ...base, frequency_s: 0 }).error);
  assert.ok(validateVariable({ ...base, frequency_s: 86401 }).error);
  assert.ok(validateVariable({ ...base, address: 65536 }).error);
  assert.ok(validateVariable({ ...base, unit: 'x'.repeat(21) }).error);
});
