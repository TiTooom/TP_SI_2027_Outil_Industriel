// Client Modbus testé avec une fausse classe de connexion : aucun réseau.
const { test } = require('node:test');
const assert = require('node:assert');
const { createModbusClient } = require('../src/services/modbusClient');
const { classifyError } = require('../src/services/plcState');

function fakeClass(behaviour) {
  const instances = [];
  class Fake {
    constructor() { this.isOpen = false; instances.push(this); }
    on() {}
    setID() {}
    setTimeout() {}
    close(cb) { this.isOpen = false; cb(); }
    async connectTCP() { this.isOpen = true; }
    async readHoldingRegisters(addr) { return behaviour(addr); }
  }
  return { Fake, instances };
}

const target = { plc_id: 1, host: 'h', port: 502, unit_id: 1, register_type: 'holding', address: 0, data_type: 'int16', scale: 1, value_offset: 0 };

test('a Modbus exception keeps the connection open; a network error drops it', async () => {
  let mode = 'exception';
  const { Fake, instances } = fakeClass(async () => {
    if (mode === 'exception') throw Object.assign(new Error('Illegal address'), { modbusCode: 2 });
    if (mode === 'network') throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    return { data: [5] };
  });
  const client = createModbusClient({ timeoutMs: 100, ClientClass: Fake });
  await assert.rejects(client.read(target), (e) => e.modbusCode === 2);
  assert.strictEqual((await (mode = 'ok', client.read(target))), 5);
  assert.strictEqual(instances.length, 1, 'same socket reused after an exception response');
  mode = 'network';
  await assert.rejects(client.read(target));
  mode = 'ok';
  await client.read(target);
  assert.strictEqual(instances.length, 2, 'new socket after a network error');
  client.closeAll();
});

test('classifyError maps to a fixed vocabulary', () => {
  assert.strictEqual(classifyError({ code: 'ETIMEDOUT' }), 'timeout');
  assert.strictEqual(classifyError({ errno: 'ETIMEDOUT' }), 'timeout');
  assert.strictEqual(classifyError({ code: 'ECONNREFUSED' }), 'refused');
  assert.strictEqual(classifyError({ code: 'EHOSTUNREACH' }), 'unreachable');
  assert.strictEqual(classifyError(new Error('boom 10.0.0.1')), 'protocol');
});

// --- écriture ----------------------------------------------------------------------------

function writeFake(behaviour = async () => {}) {
  const instances = [];
  const writes = [];
  class Fake {
    constructor() { this.isOpen = false; instances.push(this); }
    on() {}
    setID(id) { writes.push(['unit', id]); }
    setTimeout() {}
    close(cb) { this.isOpen = false; cb(); }
    async connectTCP() { this.isOpen = true; }
    async writeRegister(addr, value) { writes.push(['FC6', addr, value]); return behaviour(); }
    async writeRegisters(addr, values) { writes.push(['FC16', addr, values]); return behaviour(); }
    async writeCoil(addr, bit) { writes.push(['FC5', addr, bit]); return behaviour(); }
  }
  return { Fake, instances, writes };
}

test('write uses FC6 for one register, FC16 for two, FC5 for a coil, and reports the stored value', async () => {
  const { Fake, writes } = writeFake();
  const client = createModbusClient({ timeoutMs: 100, ClientClass: Fake });
  const base = { plc_id: 1, host: 'h', port: 502, unit_id: 7, scale: 1, value_offset: 0 };

  const t = await client.write({ ...base, register_type: 'holding', address: 10, data_type: 'int16', scale: 0.1 }, 25.34);
  assert.deepStrictEqual(t, { value: 25.3 });
  await client.write({ ...base, register_type: 'holding', address: 20, data_type: 'uint32' }, 65536);
  await client.write({ ...base, register_type: 'coil', address: 0, data_type: 'bool' }, true);

  assert.deepStrictEqual(writes.filter((w) => w[0] !== 'unit'), [['FC6', 10, 253], ['FC16', 20, [1, 0]], ['FC5', 0, true]]);
  assert.ok(writes.some((w) => w[0] === 'unit' && w[1] === 7), 'unit id applied before writing');
  client.closeAll();
});

test('write never targets input or discrete registers and never opens a connection for them', async () => {
  const { Fake, instances, writes } = writeFake();
  const client = createModbusClient({ timeoutMs: 100, ClientClass: Fake });
  for (const [register_type, data_type] of [['input', 'int16'], ['discrete', 'bool']]) {
    await assert.rejects(client.write({ ...target, register_type, data_type }, 1), /read-only/);
  }
  assert.strictEqual(instances.length, 0);
  assert.strictEqual(writes.length, 0);
});

test('an invalid value is refused before any connection is opened', async () => {
  const { Fake, instances } = writeFake();
  const client = createModbusClient({ timeoutMs: 100, ClientClass: Fake });
  await assert.rejects(client.write(target, 70000), (e) => e.code === 'INVALID_VALUE');
  await assert.rejects(client.write(target, 'abc'), (e) => e.code === 'INVALID_VALUE');
  assert.strictEqual(instances.length, 0);
});

test('write keeps the socket after a Modbus exception and drops it after a network error', async () => {
  let mode = 'exception';
  const { Fake, instances } = writeFake(async () => {
    if (mode === 'exception') throw Object.assign(new Error('Illegal address'), { modbusCode: 2 });
    if (mode === 'network') throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
  });
  const client = createModbusClient({ timeoutMs: 100, ClientClass: Fake });
  await assert.rejects(client.write(target, 1), (e) => e.modbusCode === 2);
  mode = 'ok';
  await client.write(target, 1);
  assert.strictEqual(instances.length, 1, 'same socket reused after an exception response');
  mode = 'network';
  await assert.rejects(client.write(target, 1));
  mode = 'ok';
  await client.write(target, 1);
  assert.strictEqual(instances.length, 2, 'new socket after a network error');
  client.closeAll();
});

test('a write that never answers times out instead of hanging', async () => {
  const { Fake } = writeFake(() => new Promise(() => {}));
  const client = createModbusClient({ timeoutMs: 20, ClientClass: Fake });
  await assert.rejects(client.write(target, 1), (e) => e.code === 'ETIMEDOUT');
  client.closeAll();
});
