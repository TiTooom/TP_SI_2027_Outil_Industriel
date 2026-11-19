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
