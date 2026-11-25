// POST /api/variables/:id/write testé avec des dépôts et un poller factices (aucun réseau, aucune base).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

Object.assign(process.env, {
  DB_API_USER: 'api', DB_API_PASSWORD: 'x', DB_POLLER_USER: 'poller', DB_POLLER_PASSWORD: 'x',
});
const { listenOnSafePort } = require('./helpers/listen');
const { createApp } = require('../src/app');
const { authDeps, cookieFor } = require('./helpers/fakeAuth');

const plc = { id: 1, name: 'Sim', enabled: true };
const base = { plc_id: 1, enabled: true, writable: true, register_type: 'holding', data_type: 'int16', scale: 0.1, value_offset: 0 };
const VARIABLES = {
  5: { ...base, id: 5, name: 'Consigne' },
  6: { ...base, id: 6, name: 'Marche', register_type: 'coil', data_type: 'bool', scale: 1 },
  7: { ...base, id: 7, name: 'Mesure', writable: false },
  8: { ...base, id: 8, name: 'Pause', enabled: false },
  9: { ...base, id: 9, name: 'Sur automate coupé', plc_id: 2 },
};
const PLCS = { 1: plc, 2: { ...plc, id: 2, enabled: false } };

let server;
let root;
let writes;
let logs;
let pollerImpl;

beforeEach(() => {
  writes = [];
  logs = [];
  pollerImpl = async () => ({ written: 25.3, readBack: 25.3 });
  const deps = authDeps({
    variableRepo: { findById: async (id) => VARIABLES[id] || null },
    plcRepo: { findById: async (id) => PLCS[id] || null },
    poller: { write: async (id, value) => { writes.push([id, value]); return pollerImpl(id, value); } },
    logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) },
  });
  server.removeAllListeners('request');
  server.on('request', createApp(deps));
});
before(async () => {
  server = http.createServer();
  await listenOnSafePort(server);
  root = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((r) => server.close(r)));

const post = (id, body, role = 'technician') => fetch(`${root}/variables/${id}/write`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieFor(role) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('a technician writes a value: the poller receives it and the answer carries the read-back', async () => {
  const res = await post(5, { value: 25.34 });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { variable_id: 5, written: 25.3, read_back: 25.3 });
  assert.deepStrictEqual(writes, [[5, 25.34]]);
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0][1], /PLC write by technician \(technician\): variable 5 "Consigne" = 25\.3/);
});

test('the answer says so when the read-back is unavailable', async () => {
  pollerImpl = async () => ({ written: 25.3, readBack: null });
  const body = await (await post(5, { value: 25.3 })).json();
  assert.strictEqual(body.read_back, null);
  assert.match(logs[0][1], /read back: unavailable/);
});

test('a coil takes a boolean and nothing else', async () => {
  assert.strictEqual((await post(6, { value: true })).status, 200);
  assert.strictEqual((await post(6, { value: 0 })).status, 200);
  for (const value of [2, 'true', null]) assert.strictEqual((await post(6, { value })).status, 400, String(value));
  assert.deepStrictEqual(writes, [[6, true], [6, 0]]);
});

test('a bad body or id is a 400 and never reaches the poller', async () => {
  for (const body of [undefined, {}, [], { value: 1, extra: 1 }, { val: 1 }]) {
    const res = await post(5, body);
    assert.strictEqual(res.status, 400, JSON.stringify(body));
    await res.arrayBuffer();
  }
  for (const id of ['abc', '0', '-1', '1.5']) assert.strictEqual((await post(id, { value: 1 })).status, 400, id);
  for (const value of ['12', null, true, {}]) assert.strictEqual((await post(5, { value })).status, 400, String(value));
  assert.strictEqual(writes.length, 0);
});

test('an out-of-range value is refused with the allowed range, before the poller', async () => {
  const res = await post(5, { value: 4000 });
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(await res.json(), { error: 'Value out of range: must be between -3276.8 and 3276.7' });
  assert.strictEqual(writes.length, 0);
});

test('unknown, read-only, disabled variables and disabled PLCs are refused without any write', async () => {
  const cases = [[404, 99, 'Variable not found'], [409, 7, 'Variable is not writable'],
    [409, 8, 'Variable is disabled'], [409, 9, 'PLC is disabled']];
  for (const [status, id, error] of cases) {
    const res = await post(id, { value: 1 });
    assert.strictEqual(res.status, status, `variable ${id}`);
    assert.deepStrictEqual(await res.json(), { error });
  }
  assert.strictEqual(writes.length, 0);
});

test('PLC failures map to fixed messages and statuses without leaking raw errors', async () => {
  const cases = [
    [Object.assign(new Error('connect ECONNREFUSED 10.9.9.9:502'), { code: 'ECONNREFUSED' }), 502, 'PLC write failed: refused'],
    [Object.assign(new Error('Write timed out after 3000 ms'), { code: 'ETIMEDOUT' }), 504, 'PLC write failed: timeout'],
    [Object.assign(new Error('getaddrinfo ENOTFOUND plc.internal'), { code: 'ENOTFOUND' }), 502, 'PLC write failed: unreachable'],
    [new Error('boom with 10.0.0.7 inside'), 502, 'PLC write failed: protocol'],
    [Object.assign(new Error('Illegal data address'), { modbusCode: 2 }), 502, 'PLC refused the write (Modbus exception 2)'],
    [Object.assign(new Error('gone'), { code: 'NOT_WRITABLE' }), 409, 'Variable is not writable'],
  ];
  for (const [err, status, error] of cases) {
    pollerImpl = async () => { throw err; };
    const res = await post(5, { value: 1 });
    assert.strictEqual(res.status, status, error);
    assert.deepStrictEqual(await res.json(), { error });
  }
  assert.ok(logs.every(([level]) => level === 'warn'), 'failures are logged as warnings');
});

test('a viewer cannot write; technician, engineer and admin can', async () => {
  const viewer = await post(5, { value: 1 }, 'viewer');
  assert.strictEqual(viewer.status, 403);
  await viewer.arrayBuffer();
  assert.strictEqual(writes.length, 0);
  for (const role of ['technician', 'engineer', 'admin']) assert.strictEqual((await post(5, { value: 1 }, role)).status, 200, role);
});

test('without a session the route answers 401, and other methods on the path do not write', async () => {
  const anon = await fetch(`${root}/variables/5/write`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"value":1}' });
  assert.strictEqual(anon.status, 401);
  const get = await fetch(`${root}/variables/5/write`, { headers: { Cookie: cookieFor('admin') } });
  assert.strictEqual(get.status, 404);
  assert.strictEqual(writes.length, 0);
});
