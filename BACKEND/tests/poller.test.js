// Scheduler testé avec de faux timers : aucune attente réelle, aucune connexion réseau.
const { test } = require('node:test');
const assert = require('node:assert');
const { createPoller } = require('../src/jobs/poller');

const target = (id, over = {}) => ({
  variable_id: id, plc_id: 1, plc_name: 'P', host: 'h', port: 502, unit_id: 1,
  register_type: 'holding', address: id, data_type: 'int16', scale: 1, value_offset: 0, frequency_s: 2, ...over,
});

function setup(initial, readImpl = async () => 42) {
  let targets = initial;
  const timers = new Map();
  let nextTimer = 1;
  const inserts = [];
  const reads = [];
  const retries = [];
  const poller = createPoller({
    repository: {
      loadActiveTargets: async () => { if (targets instanceof Error) throw targets; return targets; },
      insertMeasure: async (m) => { inserts.push(m); },
    },
    modbus: { read: async (t) => { reads.push(t.variable_id); return readImpl(t); }, closeAll: () => {} },
    setIntervalFn: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearIntervalFn: (id) => timers.delete(id),
    setTimeoutFn: (fn, ms) => { const r = { fn, ms, cleared: false }; retries.push(r); return r; },
    clearTimeoutFn: (r) => { r.cleared = true; },
    reloadRetryMs: 5000,
    logger: { error: () => {} },
  });
  return { poller, timers, inserts, reads, retries, setTargets: (t) => { targets = t; } };
}
const flush = () => new Promise((r) => setImmediate(r));

test('reload schedules one interval per variable, in milliseconds, and reads immediately', async () => {
  const s = setup([target(1), target(2, { frequency_s: 10 })]);
  await s.poller.reload();
  await flush();
  assert.deepStrictEqual([...s.timers.values()].map((t) => t.ms), [2000, 10000]);
  assert.deepStrictEqual(s.inserts.map((m) => [m.variableId, m.value, m.quality]), [[1, 42, 'good'], [2, 42, 'good']]);
});

test('update replans only changed variables; delete cancels the timer', async () => {
  const s = setup([target(1), target(2)]);
  await s.poller.reload();
  const before = [...s.timers.keys()];
  s.setTargets([target(1), target(2, { frequency_s: 5 })]);
  await s.poller.syncVariable(2);
  assert.ok(s.timers.has(before[0]), 'unchanged task keeps its timer');
  assert.ok(!s.timers.has(before[1]), 'changed task timer was cleared');
  assert.deepStrictEqual([...s.timers.values()].map((t) => t.ms), [2000, 5000]);
  s.setTargets([target(1)]);
  await s.poller.syncVariable(2);
  assert.strictEqual(s.timers.size, 1);
});

test('failed read stores NULL with quality bad and marks the PLC offline, then online again', async () => {
  let fail = true;
  const s = setup([target(1)], async () => {
    if (fail) throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
    return 7;
  });
  assert.strictEqual(s.poller.getPlcState(1).state, 'unknown');
  await s.poller.reload();
  await flush();
  assert.deepStrictEqual([s.inserts[0].value, s.inserts[0].quality], [null, 'bad']);
  assert.strictEqual(s.poller.getPlcState(1).state, 'offline');
  assert.strictEqual(s.poller.getPlcState(1).last_error, 'refused');
  fail = false;
  [...s.timers.values()][0].fn();
  await flush();
  assert.strictEqual(s.poller.getPlcState(1).state, 'online');
  assert.strictEqual(s.inserts[1].quality, 'good');
});

test('a tick is skipped while the previous read of the same variable is still running', async () => {
  let release;
  const s = setup([target(1)], () => new Promise((r) => { release = r; }));
  await s.poller.reload();
  const { fn } = [...s.timers.values()][0];
  fn();
  fn();
  await flush();
  assert.strictEqual(s.reads.length, 1);
  release(1);
  await flush();
  fn();
  await flush();
  assert.strictEqual(s.reads.length, 2);
});

test('reads on the same PLC are serialized', async () => {
  let active = 0;
  let maxActive = 0;
  const s = setup([target(1), target(2)], async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return 1;
  });
  await s.poller.reload();
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(maxActive, 1);
  assert.strictEqual(s.inserts.length, 2);
});

test('database failure on reload keeps the schedule and retries later, once', async () => {
  const s = setup([target(1)]);
  await s.poller.reload();
  s.setTargets(new Error('db down'));
  assert.strictEqual(await s.poller.reload(), false);
  assert.strictEqual(await s.poller.reload(), false);
  assert.strictEqual(s.timers.size, 1);
  assert.strictEqual(s.retries.length, 1);
  assert.strictEqual(s.retries[0].ms, 5000);
  s.setTargets([target(1), target(2)]);
  s.retries[0].fn();
  await flush();
  assert.strictEqual(s.timers.size, 2);
});

test('a Modbus exception keeps the PLC online and only the variable is bad', async () => {
  const s = setup([target(1)], async () => { throw Object.assign(new Error('Illegal address'), { modbusCode: 2 }); });
  await s.poller.reload();
  await flush();
  assert.strictEqual(s.poller.getPlcState(1).state, 'online');
  assert.deepStrictEqual([s.inserts[0].value, s.inserts[0].quality], [null, 'bad']);
});

test('error categories hide raw messages', async () => {
  const s = setup([target(1)], async () => { throw new Error('connect 10.1.2.3:502 something'); });
  await s.poller.reload();
  await flush();
  assert.strictEqual(s.poller.getPlcState(1).last_error, 'protocol');
});

test('stop during a pending reload schedules nothing', async () => {
  const s = setup([target(1)]);
  const pending = s.poller.reload();
  await s.poller.stop();
  await pending;
  assert.strictEqual(s.timers.size, 0);
  assert.strictEqual(s.retries.filter((r) => !r.cleared).length, 0);
});

test('stop cancels every timer', async () => {
  const s = setup([target(1), target(2)]);
  await s.poller.reload();
  await s.poller.stop();
  assert.strictEqual(s.timers.size, 0);
});

// --- écriture vers l'automate ------------------------------------------------------------

function writeSetup({ writable = target(1), writeImpl = async () => ({ value: 25 }), readImpl = async () => 25 } = {}) {
  const log = [];
  const inserts = [];
  const poller = createPoller({
    repository: {
      loadActiveTargets: async () => [],
      findWritableTarget: async (id) => { log.push(`lookup ${id}`); return writable; },
      insertMeasure: async (m) => { inserts.push(m); },
    },
    modbus: {
      read: async (t) => { log.push(`read ${t.variable_id}`); return readImpl(t); },
      write: async (t, v) => { log.push(`write ${t.variable_id}=${v}`); return writeImpl(t, v); },
      closeAll: () => {},
    },
    logger: { error: () => {} },
  });
  return { poller, log, inserts };
}

test('write sends the value, reads it back, stores the read-back as a measure and returns both', async () => {
  const s = writeSetup({ writeImpl: async () => ({ value: 25.3 }), readImpl: async () => 25.3 });
  const result = await s.poller.write(1, 25.34);
  assert.deepStrictEqual(result, { written: 25.3, readBack: 25.3 });
  assert.deepStrictEqual(s.log, ['lookup 1', 'write 1=25.34', 'read 1']);
  assert.deepStrictEqual(s.inserts.map((m) => [m.variableId, m.value, m.quality]), [[1, 25.3, 'good']]);
  assert.strictEqual(s.poller.getPlcState(1).state, 'online');
});

test('write refuses a variable the repository does not return as writable, without touching the PLC', async () => {
  const s = writeSetup({ writable: null });
  await assert.rejects(s.poller.write(1, 5), (e) => e.code === 'NOT_WRITABLE');
  assert.deepStrictEqual(s.log, ['lookup 1']);
});

test('a write waits for the read in progress on the same PLC (one socket, one request at a time)', async () => {
  let releaseRead;
  const s = writeSetup();
  // Une lecture longue occupe l'automate 1 : on la lance via un poller dont le dépôt renvoie une cible active.
  const slow = createPoller({
    repository: {
      loadActiveTargets: async () => [target(2)],
      findWritableTarget: async () => target(1),
      insertMeasure: async () => {},
    },
    modbus: {
      // Seule la première lecture (celle du relevé) est bloquée ; la relecture qui suit l'écriture répond tout de suite.
      read: (t) => {
        s.log.push(`read ${t.variable_id}`);
        if (releaseRead) return Promise.resolve(7);
        return new Promise((resolve) => { releaseRead = () => resolve(7); });
      },
      write: async (t, v) => { s.log.push(`write ${t.variable_id}=${v}`); return { value: v }; },
      closeAll: () => {},
    },
    setIntervalFn: () => 1, clearIntervalFn: () => {},
    logger: { error: () => {} },
  });
  await slow.reload();
  await flush();
  const pending = slow.write(1, 5);
  await flush();
  await flush();
  assert.deepStrictEqual(s.log, ['read 2'], 'write has not started while the read is running');
  releaseRead();
  await pending;
  assert.deepStrictEqual(s.log.slice(0, 3), ['read 2', 'write 1=5', 'read 1']);
});

test('a network failure marks the PLC offline, a Modbus exception does not, an invalid value changes nothing', async () => {
  const net = writeSetup({ writeImpl: async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); } });
  await assert.rejects(net.poller.write(1, 5), (e) => e.code === 'ECONNREFUSED');
  assert.strictEqual(net.poller.getPlcState(1).state, 'offline');
  assert.strictEqual(net.poller.getPlcState(1).last_error, 'refused');

  const exc = writeSetup({ writeImpl: async () => { throw Object.assign(new Error('Illegal'), { modbusCode: 2 }); } });
  await assert.rejects(exc.poller.write(1, 5), (e) => e.modbusCode === 2);
  assert.strictEqual(exc.poller.getPlcState(1).state, 'online', 'the PLC answered');

  const bad = writeSetup({ writeImpl: async () => { throw Object.assign(new Error('range'), { code: 'INVALID_VALUE' }); } });
  await assert.rejects(bad.poller.write(1, 5), (e) => e.code === 'INVALID_VALUE');
  assert.strictEqual(bad.poller.getPlcState(1).state, 'unknown');
  assert.strictEqual(bad.inserts.length, 0, 'no read-back after a refused write');
});

test('a failed write does not block the next operations of the queue', async () => {
  let fail = true;
  const s = writeSetup({ writeImpl: async (t, v) => { if (fail) throw new Error('boom'); return { value: v }; } });
  await assert.rejects(s.poller.write(1, 1));
  fail = false;
  assert.deepStrictEqual(await s.poller.write(1, 2), { written: 2, readBack: 25 });
});

test('write reports a null read-back when the read-back itself fails', async () => {
  const s = writeSetup({ readImpl: async () => { throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' }); } });
  const result = await s.poller.write(1, 5);
  assert.strictEqual(result.readBack, null);
  assert.deepStrictEqual(s.inserts.map((m) => m.quality), ['bad']);
});

test('write is refused once the poller is stopped', async () => {
  const s = writeSetup();
  await s.poller.stop();
  await assert.rejects(s.poller.write(1, 5), (e) => e.code === 'STOPPED');
});
