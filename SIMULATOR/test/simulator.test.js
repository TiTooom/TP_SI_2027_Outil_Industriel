const { test } = require('node:test');
const assert = require('node:assert');
const { SIGNALS, rawValue } = require('../src/signals');
const { createVector } = require('../src/vector');

test('rawValue stays within the declared range for any time and noise', () => {
  for (const s of SIGNALS) {
    for (let t = 0; t < 1000; t += 7) {
      for (const noise of [-1, 0, 1]) {
        const v = rawValue(s, t, noise);
        assert.ok(Number.isInteger(v) && v >= s.min && v <= s.max, `${s.address}@${t}: ${v}`);
      }
    }
  }
});

test('vector serves registers and answers with Modbus exceptions otherwise', () => {
  const v = createVector([10, 20]);
  assert.strictEqual(v.getHoldingRegister(1, 1), 20);
  assert.strictEqual(v.getInputRegister(0, 1), 10);
  const code = (fn) => { try { fn(); } catch (e) { return e.modbusErrorCode; } return null; };
  assert.strictEqual(code(() => v.getHoldingRegister(2, 1)), 0x02);
  assert.strictEqual(code(() => v.getHoldingRegister(0, 9)), 0x0b);
  assert.strictEqual(code(() => v.getCoil(0, 1)), 0x02);
  assert.strictEqual(code(() => v.getDiscreteInput(0, 1)), 0x02);
  assert.strictEqual(code(() => v.setRegister(0, 1, 1)), 0x01);
  assert.strictEqual(code(() => v.setCoil(0, true, 1)), 0x01);
});
