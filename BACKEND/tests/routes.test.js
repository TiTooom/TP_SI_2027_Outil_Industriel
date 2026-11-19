// Routes testées avec des repositories et un poller factices (aucune base de données).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

Object.assign(process.env, {
  DB_API_USER: 'api', DB_API_PASSWORD: 'x', DB_POLLER_USER: 'poller', DB_POLLER_PASSWORD: 'x',
});
const { listenOnSafePort } = require('./helpers/listen');
const { createApp } = require('../src/app');

const plc = { id: 1, name: 'Sim', host: 'simulator', port: 5020, unit_id: 1, enabled: true, variable_count: 0 };
let calls;
let plcRepo;
let variableRepo;
let server;
let base;

beforeEach(() => {
  calls = [];
  plcRepo = {
    list: async () => [plc, { ...plc, id: 2, name: 'Off', enabled: false }],
    findById: async (id) => (id === 1 ? plc : null),
    create: async (v) => ({ ...plc, ...v, id: 9 }),
    update: async (id, v) => ({ ...plc, ...v, id }),
    countActiveVariables: async () => 0,
    count: async () => 0,
    remove: async (id) => { calls.push(['remove', id]); return true; },
  };
  variableRepo = {
    list: async (plcId) => { calls.push(['list', plcId]); return []; },
    findById: async (id) => (id === 5 ? { id: 5, plc_id: 1 } : null),
    create: async (v) => ({ ...v, id: 7 }),
    update: async (id, v) => ({ ...v, id }),
    softDelete: async (id) => id === 5,
    count: async () => 0,
  };
  const poller = {
    syncPlc: async (id) => { calls.push(['syncPlc', id]); },
    syncVariable: async (id) => { calls.push(['syncVariable', id]); },
    getPlcState: () => ({ state: 'online', last_error: null, last_success_at: 'T', last_attempt_at: 'T' }),
  };
  server.removeAllListeners('request');
  server.on('request', createApp({ plcRepo, variableRepo, poller }));
});

before(async () => {
  server = http.createServer();
  await listenOnSafePort(server);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((r) => server.close(r)));

const send = (method, path, body) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const validVar = { plc_id: 1, name: 'T', register_type: 'holding', address: 0, data_type: 'int16', frequency_s: 2 };

test('GET /plcs/status is not shadowed by /:id and hides state of disabled PLCs', async () => {
  const res = await send('GET', '/plcs/status');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body[0].state, 'online');
  assert.strictEqual(body[1].state, 'unknown');
});

test('POST /plcs creates (201), resyncs the poller, rejects invalid input (400)', async () => {
  const ok = await send('POST', '/plcs', { name: 'N', host: '10.0.0.1' });
  assert.strictEqual(ok.status, 201);
  assert.deepStrictEqual(calls, [['syncPlc', 9]]);
  assert.strictEqual((await send('POST', '/plcs', { name: 'N', host: 'bad host' })).status, 400);
});

test('POST /plcs maps duplicate names to 409', async () => {
  plcRepo.create = async () => { throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); };
  assert.strictEqual((await send('POST', '/plcs', { name: 'N', host: 'h' })).status, 409);
});

test('plc id handling: 400 invalid, 404 unknown', async () => {
  assert.strictEqual((await send('GET', '/plcs/abc')).status, 400);
  assert.strictEqual((await send('GET', '/plcs/0')).status, 400);
  assert.strictEqual((await send('GET', '/plcs/42')).status, 404);
  assert.strictEqual((await send('PUT', '/plcs/42', { name: 'N', host: 'h' })).status, 404);
});

test('DELETE /plcs/:id is refused with 409 while variables exist, else 204', async () => {
  plcRepo.countActiveVariables = async () => 2;
  assert.strictEqual((await send('DELETE', '/plcs/1')).status, 409);
  assert.deepStrictEqual(calls, []);
  plcRepo.countActiveVariables = async () => 0;
  assert.strictEqual((await send('DELETE', '/plcs/1')).status, 204);
});

test('DELETE /plcs/:id maps a foreign-key refusal to 409 (measurement history)', async () => {
  plcRepo.remove = async () => { throw Object.assign(new Error('fk'), { code: 'ER_ROW_IS_REFERENCED_2' }); };
  const res = await send('DELETE', '/plcs/1');
  assert.strictEqual(res.status, 409);
  assert.deepStrictEqual(await res.json(), { error: 'PLC has measurement history' });
  assert.deepStrictEqual(calls, []);
});

test('PLC and variable creation are capped with 409', async () => {
  plcRepo.count = async () => 50;
  assert.strictEqual((await send('POST', '/plcs', { name: 'N', host: '10.0.0.1' })).status, 409);
  variableRepo.count = async () => 1000;
  assert.strictEqual((await send('POST', '/variables', validVar)).status, 409);
  assert.deepStrictEqual(calls, []);
});

test('POST /plcs refuses loopback, link-local and internal service hosts', async () => {
  for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '::1', 'db', 'backend', 'frontend']) {
    assert.strictEqual((await send('POST', '/plcs', { name: 'N', host })).status, 400, host);
  }
  assert.strictEqual((await send('POST', '/plcs', { name: 'N', host: 'simulator' })).status, 201);
});

test('oversized body returns a JSON 413', async () => {
  const res = await send('POST', '/plcs', { name: 'x'.repeat(200000), host: 'h' });
  assert.strictEqual(res.status, 413);
  assert.ok((await res.json()).error);
});

test('POST /variables validates, checks the PLC, and syncs the poller', async () => {
  assert.strictEqual((await send('POST', '/variables', { ...validVar, frequency_s: 0 })).status, 400);
  assert.strictEqual((await send('POST', '/variables', { ...validVar, plc_id: 99 })).status, 400);
  const ok = await send('POST', '/variables', validVar);
  assert.strictEqual(ok.status, 201);
  assert.deepStrictEqual(calls, [['syncVariable', 7]]);
});

test('PUT /variables/:id returns 200, 404 and 409', async () => {
  assert.strictEqual((await send('PUT', '/variables/5', validVar)).status, 200);
  assert.strictEqual((await send('PUT', '/variables/6', validVar)).status, 404);
  variableRepo.update = async () => { throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); };
  assert.strictEqual((await send('PUT', '/variables/5', validVar)).status, 409);
  variableRepo.update = async () => null;
  assert.strictEqual((await send('PUT', '/variables/5', validVar)).status, 404);
});

test('DELETE /variables/:id soft-deletes (204), 404 when unknown, and resyncs', async () => {
  assert.strictEqual((await send('DELETE', '/variables/5')).status, 204);
  assert.deepStrictEqual(calls, [['syncVariable', 5]]);
  assert.strictEqual((await send('DELETE', '/variables/6')).status, 404);
});

test('GET /variables filters by plc_id and validates it', async () => {
  assert.strictEqual((await send('GET', '/variables?plc_id=1')).status, 200);
  assert.deepStrictEqual(calls, [['list', 1]]);
  assert.strictEqual((await send('GET', '/variables?plc_id=x')).status, 400);
});

test('unexpected repository failures return a JSON 500 without details', async () => {
  plcRepo.list = async () => { throw new Error('secret db detail'); };
  const res = await send('GET', '/plcs');
  assert.strictEqual(res.status, 500);
  assert.deepStrictEqual(await res.json(), { error: 'Internal server error' });
});
