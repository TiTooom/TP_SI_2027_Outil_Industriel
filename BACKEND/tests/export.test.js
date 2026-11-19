// GET /api/export.csv avec des repositories factices (aucune base de données).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Readable } = require('node:stream');

Object.assign(process.env, {
  DB_API_USER: 'api', DB_API_PASSWORD: 'x', DB_POLLER_USER: 'poller', DB_POLLER_PASSWORD: 'x',
  EXPORT_TZ: 'Europe/Paris',
});
const { listenOnSafePort } = require('./helpers/listen');
const { createApp } = require('../src/app');
const { textCell, numberCell } = require('../src/services/csvWriter');
const exportService = require('../src/services/exportService');
const { filenameFor } = exportService;

const VARS = {
  1: { id: 1, name: 'Temp', plc_name: 'PLC; "A"', unit: '°C', scale: 0.1, value_offset: 0, data_type: 'int16' },
  2: { id: 2, name: '=SUM(A1)', plc_name: 'PLC', unit: '-', scale: 0.01, value_offset: 0, data_type: 'int16' },
  3: { id: 3, name: 'Old', plc_name: 'PLC', unit: 'bar', scale: 1, value_offset: 0, data_type: 'float32', deleted_at: '2026-11-01T00:00:00.000Z' },
};
const HEADER = 'Horodatage local;Horodatage UTC (ISO);Automate;Variable;Valeur;Unité;Qualité';
let rows;
let countCalls;
let cancelled;
let server;
let base;

const RANGE = 'from=2026-11-19T10:00:00Z&to=2026-11-19T11:00:00Z';

function install(measureRepo, variableRepo) {
  server.removeAllListeners('request');
  server.on('request', createApp({ plcRepo: {}, variableRepo, measureRepo, poller: {} }));
}

beforeEach(() => {
  countCalls = 0;
  cancelled = false;
  rows = [
    { variable_id: 1, ts: new Date('2026-11-19T10:00:02.123Z'), value: 21.400000000000006, quality: 'good' },
    { variable_id: 2, ts: new Date('2026-11-19T10:00:02.123Z'), value: -3.2, quality: 'good' },
    { variable_id: 1, ts: new Date('2026-11-19T10:00:03.000Z'), value: null, quality: 'bad' },
    { variable_id: 3, ts: new Date('2026-07-19T10:00:04.000Z'), value: 5.12345, quality: 'good' },
  ];
  install(
    {
      countRange: async () => { countCalls += 1; return rows.length; },
      openRangeStream: async () => ({ stream: Readable.from(rows), cancel: () => { cancelled = true; } }),
    },
    { findManyIncludingDeleted: async (ids) => ids.filter((i) => VARS[i]).map((i) => VARS[i]) },
  );
});

before(async () => {
  server = http.createServer();
  await listenOnSafePort(server);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((r) => server.close(r)));

const get = (q) => fetch(`${base}/export.csv?${q}`);

test('export returns BOM, French header, CRLF and download headers', async () => {
  const res = await get(`variableIds=1,2,3&${RANGE}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  assert.strictEqual(res.headers.get('content-disposition'),
    'attachment; filename="export_20261119T100000Z_20261119T110000Z.csv"');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = bytes.toString('utf8').split('\r\n');
  assert.strictEqual(lines[0], `﻿${HEADER}`);
  assert.strictEqual(lines.length, 6); // en-tête + 4 lignes + fin vide
});

test('export rows: decimal comma, rounding, quoting, local time, bad quality', async () => {
  const text = (await (await get(`variableIds=1,2,3&${RANGE}`)).text()).replace('﻿', '');
  const lines = text.split('\r\n');
  assert.strictEqual(lines[1], '2026-11-19 11:00:02;2026-11-19T10:00:02.123Z;"PLC; ""A""";Temp;21,4;°C;good');
  assert.strictEqual(lines[2], "2026-11-19 11:00:02;2026-11-19T10:00:02.123Z;PLC;'=SUM(A1);-3,2;'-;good");
  assert.strictEqual(lines[3], '2026-11-19 11:00:03;2026-11-19T10:00:03.000Z;"PLC; ""A""";Temp;;°C;bad');
  // heure d'été (UTC+2) et float32 à 3 décimales
  assert.strictEqual(lines[4], '2026-07-19 12:00:04;2026-07-19T10:00:04.000Z;PLC;Old;5,123;bar;good');
});

test('csv cells: formula injection and quoting', () => {
  for (const c of ['=1+1', '+1', '-1', '@x', '\tx']) assert.strictEqual(textCell(c), `'${c}`);
  assert.strictEqual(textCell('a;b'), '"a;b"');
  assert.strictEqual(textCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(textCell('l1\nl2'), '"l1\nl2"');
  assert.strictEqual(textCell('\nx'), '"\'\nx"');
  assert.strictEqual(textCell('plain'), 'plain');
  assert.strictEqual(textCell(null), '');
  assert.strictEqual(numberCell(-3.25), '-3,25');
  assert.strictEqual(numberCell(null), '');
});

test('check=1 answers JSON with the row count and no CSV', async () => {
  const res = await get(`variableIds=1&${RANGE}&check=1`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /json/);
  assert.deepStrictEqual(await res.json(), { rows: 4 });
  assert.strictEqual((await get(`variableIds=1&${RANGE}&check=2`)).status, 400);
});

test('empty range gives header only', async () => {
  rows = [];
  const bytes = Buffer.from(await (await get(`variableIds=1&${RANGE}`)).arrayBuffer());
  assert.strictEqual(bytes.toString('utf8'), `﻿${HEADER}\r\n`);
});

test('deleted variable is exportable, unknown id gives 404 before any CSV', async () => {
  rows = rows.slice(3);
  const ok = await get(`variableIds=3&${RANGE}`);
  assert.strictEqual(ok.status, 200);
  await ok.arrayBuffer();
  const res = await get(`variableIds=1,99&${RANGE}`);
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(await res.json(), { error: 'Variable not found: 99' });
});

test('validation errors return 400 JSON', async () => {
  rows = [];
  const fiftyOne = Array.from({ length: 51 }, (_, i) => i + 1).join(',');
  const cases = [
    RANGE, 'variableIds=&' + RANGE, 'variableIds=abc&' + RANGE, 'variableIds=0&' + RANGE,
    'variableIds=1,,2&' + RANGE, 'variableIds=-1&' + RANGE, 'variableIds=1.5&' + RANGE,
    `variableIds=${fiftyOne}&${RANGE}`,
    'variableIds=1', 'variableIds=1&from=2026-11-19T10:00:00Z', 'variableIds=1&to=2026-11-19T10:00:00Z',
    'variableIds=1&from=2026-11-19T11:00:00Z&to=2026-11-19T10:00:00Z', // plage inversée
    'variableIds=1&from=2026-11-19T10:00:00Z&to=2026-11-19T10:00:00Z', // plage nulle
    'variableIds=1&from=2026-11-19T10:00:00&to=2026-11-19T11:00:00', // sans fuseau
    'variableIds=1&from=2026-10-19T09:59:59Z&to=2026-11-19T10:00:00Z', // > 31 jours
  ];
  for (const q of cases) {
    const res = await get(q);
    assert.strictEqual(res.status, 400, q);
    assert.match(res.headers.get('content-type'), /json/);
    assert.strictEqual(typeof (await res.json()).error, 'string');
  }
  // exactement 31 jours : accepté
  const edge = await get('variableIds=1&from=2026-10-19T10:00:00Z&to=2026-11-19T10:00:00Z');
  assert.strictEqual(edge.status, 200);
  await edge.arrayBuffer();
});

test('too many rows is rejected before streaming', async () => {
  install(
    { countRange: async () => 500001, openRangeStream: async () => { throw new Error('must not stream'); } },
    { findManyIncludingDeleted: async () => [VARS[1]] },
  );
  const res = await get(`variableIds=1&${RANGE}`);
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(await res.json(), {
    error: 'Too many rows (500001 > 500000), narrow the range or select fewer variables',
  });
});

test('duplicate ids are deduplicated and the count runs once', async () => {
  assert.strictEqual((await get(`variableIds=1,1&${RANGE}&check=1`)).status, 200);
  assert.strictEqual(countCalls, 1);
});

test('export has no write method', async () => {
  const res = await fetch(`${base}/export.csv?${RANGE}`, { method: 'POST' });
  assert.ok(res.status >= 400 && res.status < 500);
});

test('filename uses compact UTC range', () => {
  assert.strictEqual(filenameFor(new Date('2026-11-19T10:00:00.500Z'), new Date('2026-11-19T11:00:00Z')),
    'export_20261119T100000Z_20261119T110000Z.csv');
});

test('client abort cancels the underlying query', async () => {
  rows = Array.from({ length: 300000 }, (_, i) => ({
    variable_id: 1, ts: new Date(1763546400000 + i), value: 1, quality: 'good',
  }));
  const ctrl = new AbortController();
  const res = await fetch(`${base}/export.csv?variableIds=1&${RANGE}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  await reader.read();
  ctrl.abort();
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(cancelled, true);
});

async function assertSlotsFree() {
  const held = [];
  for (let i = 0; i < exportService.MAX_CONCURRENT; i += 1) {
    const r = exportService.acquireSlot();
    assert.ok(r, 'slot should be available');
    held.push(r);
  }
  held.forEach((r) => r());
}

const bigRows = () => Array.from({ length: 300000 }, (_, i) => ({
  variable_id: 1, ts: new Date(1763546400000 + i), value: 1, quality: 'good',
}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('client gone before the stream starts (> 64 KB) cancels and frees the query', async () => {
  rows = bigRows();
  let release;
  const gate = new Promise((r) => { release = r; });
  install(
    {
      countRange: async () => rows.length,
      openRangeStream: async () => {
        await gate; // le client part pendant l'ouverture
        return { stream: Readable.from(rows), cancel: () => { cancelled = true; } };
      },
    },
    { findManyIncludingDeleted: async (ids) => ids.map((i) => VARS[i]) },
  );
  const ctrl = new AbortController();
  const pending = fetch(`${base}/export.csv?variableIds=1&${RANGE}`, { signal: ctrl.signal }).catch(() => {});
  await sleep(150);
  ctrl.abort();
  await pending;
  await sleep(100);
  release();
  await sleep(200);
  assert.strictEqual(cancelled, true);
  await assertSlotsFree();
});

test('4th concurrent export gets 429 with Retry-After, slots are freed afterwards', async () => {
  rows = bigRows();
  const ctrls = [0, 1, 2].map(() => new AbortController());
  for (const c of ctrls) {
    const res = await fetch(`${base}/export.csv?variableIds=1&${RANGE}`, { signal: c.signal });
    await res.body.getReader().read();
  }
  for (const q of [`variableIds=1&${RANGE}`, `variableIds=1&${RANGE}&check=1`]) {
    const res = await get(q);
    assert.strictEqual(res.status, 429);
    assert.ok(res.headers.get('retry-after'));
    assert.ok((await res.json()).error);
  }
  ctrls.forEach((c) => c.abort());
  await sleep(300);
  await assertSlotsFree();
});

test('slot is freed after a normal end and after a stream error', async () => {
  rows = rows.slice(0, 2);
  await (await get(`variableIds=1&${RANGE}`)).text();
  await assertSlotsFree();
  const origError = console.error;
  console.error = () => {};
  install(
    {
      countRange: async () => 1,
      openRangeStream: async () => ({
        stream: Readable.from((async function* () { throw new Error('db down'); })()),
        cancel: () => {},
      }),
    },
    { findManyIncludingDeleted: async (ids) => ids.map((i) => VARS[i]) },
  );
  const res = await get(`variableIds=1&${RANGE}`);
  console.error = origError;
  assert.strictEqual(res.status, 500);
  await sleep(50);
  await assertSlotsFree();
});
