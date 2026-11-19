const { test } = require('node:test');
const assert = require('node:assert');
const { roundValue, decimalsFor } = require('../src/services/roundValue');

test('decimals come from scale and value_offset', () => {
  assert.strictEqual(decimalsFor({ scale: 0.1, value_offset: 0, data_type: 'int16' }), 1);
  assert.strictEqual(decimalsFor({ scale: 0.01, value_offset: 0.5, data_type: 'uint16' }), 2);
  assert.strictEqual(decimalsFor({ scale: 1, value_offset: 0, data_type: 'int16' }), 0);
  assert.strictEqual(decimalsFor({ scale: 0.1, value_offset: -0.25, data_type: 'int16' }), 2);
});

test('float32 has at least 3 decimals, everything is capped at 6', () => {
  assert.strictEqual(decimalsFor({ scale: 1, value_offset: 0, data_type: 'float32' }), 3);
  assert.strictEqual(decimalsFor({ scale: 0.1, value_offset: 0, data_type: 'float32' }), 3);
  assert.strictEqual(decimalsFor({ scale: 0.0000001, value_offset: 0, data_type: 'int16' }), 6);
  assert.strictEqual(decimalsFor({ scale: 0.00001, value_offset: 0, data_type: 'float32' }), 5);
});

test('roundValue removes float artefacts and keeps null', () => {
  const v = { scale: 0.1, value_offset: 0, data_type: 'int16' };
  assert.strictEqual(roundValue(41.400000000000006, v), 41.4);
  assert.strictEqual(roundValue(null, v), null);
  assert.ok(!Object.is(roundValue(-0.04, v), -0));
  assert.strictEqual(roundValue(3.14159265, { scale: 1, value_offset: 0, data_type: 'float32' }), 3.142);
});
