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
  assert.strictEqual(code(() => v.getCoil(0, 1)), 0x02, 'no coil by default');
  assert.strictEqual(code(() => v.getDiscreteInput(0, 1)), 0x02);
  assert.strictEqual(code(() => v.setRegister(0, 1, 1)), 0x02, 'registers are read-only unless declared writable');
  assert.strictEqual(code(() => v.setCoil(0, true, 1)), 0x02);
});

test('vector lets the master write declared registers and coils only', () => {
  const registers = [10, 20, 30];
  const coils = [false, false];
  const v = createVector(registers, { writable: new Set([2]), coils });
  const code = (fn) => { try { fn(); } catch (e) { return e.modbusErrorCode; } return null; };

  assert.strictEqual(code(() => v.setRegister(2, 99, 1)), null);
  assert.strictEqual(v.getHoldingRegister(2, 1), 99);
  assert.strictEqual(v.getInputRegister(2, 1), 99, 'same value read as holding or input');
  assert.strictEqual(code(() => v.setRegister(0, 1, 1)), 0x02, 'measure registers stay read-only');
  assert.strictEqual(registers[0], 10);
  assert.strictEqual(code(() => v.setRegister(9, 1, 1)), 0x02, 'unknown register');
  assert.strictEqual(code(() => v.setRegister(2, 1, 5)), 0x0b, 'wrong unit id');

  assert.strictEqual(code(() => v.setCoil(1, true, 1)), null);
  assert.strictEqual(v.getCoil(1, 1), true);
  assert.strictEqual(code(() => v.setCoil(1, false, 1)), null);
  assert.strictEqual(v.getCoil(1, 1), false);
  assert.strictEqual(code(() => v.setCoil(2, true, 1)), 0x02, 'unknown coil');
  assert.strictEqual(code(() => v.getDiscreteInput(0, 1)), 0x02, 'still no discrete inputs');
});

// Bout en bout sur un vrai socket : prouve que la bibliothèque serveur accepte nos gestionnaires synchrones
// et transforme nos erreurs en exceptions Modbus que le client reconnaît.
test('a real Modbus client can write a setpoint and a coil, and is refused on a measure', async () => {
  const net = require('node:net');
  const ModbusRTU = require('modbus-serial');
  const { ServerTCP } = ModbusRTU;
  const { SETPOINTS, COIL_COUNT, REGISTER_COUNT } = require('../src/signals');

  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  const registers = new Array(REGISTER_COUNT).fill(0);
  for (const sp of SETPOINTS) registers[sp.address] = sp.initial;
  const coils = new Array(COIL_COUNT).fill(false);
  const vector = createVector(registers, { writable: new Set(SETPOINTS.map((sp) => sp.address)), coils });
  const server = new ServerTCP(vector, { host: '127.0.0.1', port, unitID: 1 });
  server.on('socketError', () => {});
  await new Promise((resolve) => server.on('initialized', resolve));

  const client = new ModbusRTU();
  try {
    await client.connectTCP('127.0.0.1', { port });
    client.setID(1);
    client.setTimeout(2000);

    assert.strictEqual((await client.readHoldingRegisters(10, 1)).data[0], 250, 'initial setpoint');
    await client.writeRegister(10, 300);
    assert.strictEqual((await client.readHoldingRegisters(10, 1)).data[0], 300);
    assert.strictEqual((await client.readInputRegisters(10, 1)).data[0], 300);
    await client.writeRegisters(10, [0x0001, 0x0002]); // FC16 sur deux consignes consécutives (10 et 11)
    assert.deepStrictEqual((await client.readHoldingRegisters(10, 2)).data, [1, 2]);

    await client.writeCoil(0, true);
    assert.strictEqual((await client.readCoils(0, 1)).data[0], true);
    await client.writeCoil(0, false);
    assert.strictEqual((await client.readCoils(0, 1)).data[0], false);

    await assert.rejects(client.writeRegister(0, 5), (e) => e.modbusCode === 0x02, 'a measure register refuses writes');
    await assert.rejects(client.writeCoil(COIL_COUNT, true), (e) => e.modbusCode === 0x02);
  } finally {
    await new Promise((resolve) => client.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
