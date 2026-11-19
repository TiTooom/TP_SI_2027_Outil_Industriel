// Vérifie que /api/health répond même sans base de données (démo robuste).
const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Base volontairement injoignable (port fermé).
Object.assign(process.env, {
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  DB_API_USER: 'api',
  DB_API_PASSWORD: 'test',
  DB_POLLER_USER: 'poller',
  DB_POLLER_PASSWORD: 'test',
});

const app = require('../src/app');
const { closePools } = require('../src/db/pools');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closePools();
});

test('GET /api/health reports degraded with 503 when the database is down', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(res.status, 503);
  const body = await res.json();
  assert.strictEqual(body.status, 'degraded');
  assert.deepStrictEqual(body.db, { api: 'down', poller: 'down' });
  assert.ok(Number.isInteger(body.uptime_s));
});

test('unknown API route returns a JSON 404', async () => {
  const res = await fetch(`${baseUrl}/api/nope`);
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(await res.json(), { error: 'Route not found' });
});

test('malformed JSON body returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad',
  });
  assert.strictEqual(res.status, 400);
});
