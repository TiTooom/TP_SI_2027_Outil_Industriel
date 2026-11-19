// Routes de lecture des mesures, testées avec des repositories factices (aucune base de données).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

Object.assign(process.env, {
  DB_API_USER: 'api', DB_API_PASSWORD: 'x', DB_POLLER_USER: 'poller', DB_POLLER_PASSWORD: 'x',
});
const { createApp } = require('../src/app');
const { validateMeasuresQuery } = require('../src/validation/measures');

const M1 = { ts: '2026-11-19T10:00:02.123Z', value: 21.4, quality: 'good' };
const M2 = { ts: '2026-11-19T10:00:03.123Z', value: null, quality: 'bad' };
let rangeArgs;
let listArgs;
let rawValue = 21.4;
let server;
let base;

beforeEach(() => {
  rangeArgs = null;
  rawValue = 21.4;
  const v = (id) => ({ id, plc_id: 1, scale: 0.1, value_offset: 0, data_type: 'int16' });
  const variableRepo = {
    findById: async (id) => (id === 5 || id === 6 ? v(id) : null),
    // 7 : variable supprimée logiquement, encore lisible pour l'historique.
    findByIdIncludingDeleted: async (id) => (id === 5 || id === 6 || id === 7 ? v(id) : null),
    list: async (plcId, includeDeleted) => { listArgs = { plcId, includeDeleted }; return []; },
  };
  const measureRepo = {
    findLatest: async (id) => (id === 5 ? { ...M1, value: rawValue } : null),
    findLatestOfActiveVariables: async () => [{ variable_id: 5, ...M1 }],
    findRange: async (id, from, to, limit) => { rangeArgs = { id, from, to, limit }; return [{ ...M1, value: rawValue }, M2]; },
  };
  server.removeAllListeners('request');
  server.on('request', createApp({ plcRepo: {}, variableRepo, measureRepo, poller: {} }));
});

before(async () => {
  server = http.createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((r) => server.close(r)));

const get = (path) => fetch(`${base}${path}`);
const status = async (path) => (await get(path)).status;

test('GET /variables/latest is routed before /:id', async () => {
  const res = await get('/variables/latest');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), [{ variable_id: 5, ...M1 }]);
});

test('GET /variables/:id/latest returns the measure', async () => {
  const res = await get('/variables/5/latest');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), M1);
});

test('GET /variables/:id/latest errors', async () => {
  assert.strictEqual(await status('/variables/abc/latest'), 400);
  assert.strictEqual(await status('/variables/0/latest'), 400);
  const unknown = await get('/variables/99/latest');
  assert.strictEqual(unknown.status, 404);
  assert.deepStrictEqual(await unknown.json(), { error: 'Variable not found' });
  const none = await get('/variables/6/latest');
  assert.strictEqual(none.status, 404);
  assert.deepStrictEqual(await none.json(), { error: 'No measure yet' });
});

test('GET /variables/:id/measures returns the contract shape', async () => {
  const res = await get('/variables/5/measures?from=2026-11-19T10:00:00Z&to=2026-11-19T11:00:00.000Z&limit=10');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), {
    variable_id: 5,
    from: '2026-11-19T10:00:00.000Z',
    to: '2026-11-19T11:00:00.000Z',
    count: 2,
    measures: [M1, M2],
  });
  assert.strictEqual(rangeArgs.limit, 10);
});

test('measures defaults: 10 min window and limit 500', async () => {
  const res = await get('/variables/5/measures');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(rangeArgs.limit, 500);
  assert.ok(Math.abs(rangeArgs.to - Date.now()) < 5000);
  assert.strictEqual(rangeArgs.to - rangeArgs.from, 600000);
});

test('measures validation errors return 400 with { error }', async () => {
  const to = 'to=2026-11-19T10:00:00Z';
  const cases = [
    'from=yesterday', 'from=2026-11-19T10:00:00', 'to=2026-11-19', 'from=2026-13-45T10:00:00Z',
    `${to}&from=2026-11-19T10:00:00Z`, `${to}&from=2026-11-19T11:00:00Z`,
    `${to}&from=2026-11-12T09:59:59Z`,
    'limit=0', 'limit=5001', 'limit=-1', 'limit=abc', 'limit=1.5',
  ];
  for (const q of cases) {
    const res = await get(`/variables/5/measures?${q}`);
    assert.strictEqual(res.status, 400, q);
    assert.strictEqual(typeof (await res.json()).error, 'string');
  }
  assert.strictEqual(await status('/variables/abc/measures'), 400);
});

test('measures accepts exactly 7 days and limit bounds', async () => {
  assert.strictEqual(await status('/variables/5/measures?to=2026-11-19T10:00:00Z&from=2026-11-12T10:00:00Z'), 200);
  assert.strictEqual(await status('/variables/5/measures?limit=1'), 200);
  assert.strictEqual(await status('/variables/5/measures?limit=5000'), 200);
});

test('measures of an unknown variable return 404', async () => {
  assert.strictEqual(await status('/variables/99/measures'), 404);
});

test('no write route exists on measures', async () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const p of ['/variables/5/measures', '/variables/5/latest', '/variables/latest']) {
      const res = await fetch(`${base}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.ok(res.status >= 400 && res.status < 500, `${m} ${p} -> ${res.status}`);
    }
  }
});

test('validateMeasuresQuery uses the injected clock', () => {
  const now = new Date('2026-11-19T10:00:00Z');
  const { value } = validateMeasuresQuery({}, now);
  assert.strictEqual(value.to.getTime(), now.getTime());
  assert.strictEqual(value.from.toISOString(), '2026-11-19T09:50:00.000Z');
});

test('validateMeasuresQuery rejects impossible calendar dates', () => {
  for (const bad of ['2026-02-31T10:00:00Z', '2026-13-01T10:00:00Z', '2025-02-29T00:00:00Z', '2026-04-31T00:00:00+01:00']) {
    assert.ok(validateMeasuresQuery({ from: bad }).error, bad);
  }
  assert.ok(!validateMeasuresQuery({ from: '2024-02-29T00:00:00Z', to: '2024-03-01T00:00:00Z' }).error);
});

test('latest and measures round float artefacts using scale', async () => {
  rawValue = 41.400000000000006;
  assert.strictEqual((await (await get('/variables/5/latest')).json()).value, 41.4);
  const body = await (await get('/variables/5/measures')).json();
  assert.strictEqual(body.measures[0].value, 41.4);
  assert.strictEqual(body.measures[1].value, null);
});

test('measures of a soft-deleted variable are readable, latest is not', async () => {
  assert.strictEqual(await status('/variables/7/measures'), 200);
  assert.strictEqual(await status('/variables/7/latest'), 404);
});

test('GET /variables?include_deleted forwards the flag and validates it', async () => {
  assert.strictEqual(await status('/variables?include_deleted=1'), 200);
  assert.strictEqual(listArgs.includeDeleted, true);
  await get('/variables');
  assert.strictEqual(listArgs.includeDeleted, false);
  assert.strictEqual(await status('/variables?include_deleted=yes'), 400);
});
