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
