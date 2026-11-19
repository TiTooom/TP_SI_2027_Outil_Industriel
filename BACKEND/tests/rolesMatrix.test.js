// Matrice des droits : chaque route exige une session et le rôle minimum du contrat J5.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

Object.assign(process.env, {
  DB_API_USER: 'api', DB_API_PASSWORD: 'x', DB_POLLER_USER: 'poller', DB_POLLER_PASSWORD: 'x',
});
const { listenOnSafePort } = require('./helpers/listen');
const { authDeps, cookieFor } = require('./helpers/fakeAuth');
const { ROLES } = require('../src/config/roles');
const { createApp } = require('../src/app');

// Dépôts permissifs : seul le statut 401/403 nous intéresse ici, pas la logique métier.
const anything = () => new Proxy({}, { get: () => async () => null });
let server;
let base;
const realConsoleError = console.error;

before(async () => {
  console.error = () => {}; // les 500 attendus (dépôts factices) ne doivent pas polluer la sortie
  const deps = authDeps({
    plcRepo: anything(), variableRepo: anything(), measureRepo: anything(), poller: anything(),
    userRepo: new Proxy({ findById: async () => ({ id: 1, username: 'x', email: null, role: 'viewer', teams: [] }) },
      { get: (t, k) => t[k] || (async () => null) }),
    teamRepo: anything(),
  });
  server = http.createServer(createApp(deps));
  await listenOnSafePort(server);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((resolve) => { console.error = realConsoleError; server.close(resolve); }));

const ROUTES = [
  ['GET', '/plcs', 'viewer'], ['GET', '/plcs/status', 'viewer'], ['GET', '/plcs/1', 'viewer'],
  ['GET', '/variables', 'viewer'], ['GET', '/variables/latest', 'viewer'], ['GET', '/variables/1', 'viewer'],
  ['GET', '/variables/1/latest', 'viewer'], ['GET', '/variables/1/measures', 'viewer'],
  ['GET', '/export.csv?variableIds=1', 'viewer'],
  ['PATCH', '/variables/1', 'technician', { enabled: false }],
  ['POST', '/plcs', 'engineer', {}], ['PUT', '/plcs/1', 'engineer', {}], ['DELETE', '/plcs/1', 'engineer'],
  ['POST', '/variables', 'engineer', {}], ['PUT', '/variables/1', 'engineer', {}], ['DELETE', '/variables/1', 'engineer'],
  ['GET', '/users', 'admin'], ['POST', '/users', 'admin', {}], ['GET', '/users/1', 'admin'],
  ['PUT', '/users/1', 'admin', {}], ['PUT', '/users/1/password', 'admin', {}], ['DELETE', '/users/1', 'admin'],
  ['GET', '/teams', 'admin'], ['POST', '/teams', 'admin', {}], ['GET', '/teams/1', 'admin'], ['PUT', '/teams/1', 'admin', {}],
  ['DELETE', '/teams/1', 'admin'], ['PUT', '/teams/1/members/1', 'admin', {}], ['DELETE', '/teams/1/members/1', 'admin'],
  ['GET', '/auth/me', 'viewer'], ['POST', '/auth/logout', 'viewer'], ['POST', '/auth/password', 'viewer', {}],
];

function call(method, path, body, cookie) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test('every protected route answers 401 without a session', async () => {
  for (const [method, path, , body] of ROUTES) {
    const res = await call(method, path, body);
    assert.strictEqual(res.status, 401, `${method} ${path}`);
    assert.deepStrictEqual(await res.json(), { error: 'Authentication required' });
  }
});

test('an unknown or malformed session cookie answers 401', async () => {
  for (const cookie of ['sid=nope', 'sid=', 'other=1', `sid=${'0'.repeat(64)}`]) {
    assert.strictEqual((await call('GET', '/plcs', undefined, cookie)).status, 401, cookie);
  }
});

test('role matrix: 403 below the minimum role, never 401/403 at or above it', async () => {
  for (const [method, path, min, body] of ROUTES) {
    for (const role of ROLES) {
      const res = await call(method, path, body, cookieFor(role));
      await res.arrayBuffer();
      const allowed = ROLES.indexOf(role) >= ROLES.indexOf(min);
      if (allowed) {
        assert.ok(res.status !== 401 && res.status !== 403, `${role} ${method} ${path} -> ${res.status}`);
      } else {
        assert.strictEqual(res.status, 403, `${role} ${method} ${path}`);
      }
    }
  }
});

test('health and login stay public', async () => {
  assert.notStrictEqual((await call('GET', '/health')).status, 401);
  const login = await call('POST', '/auth/login', {});
  assert.strictEqual(login.status, 400); // validation, pas 401 « Authentication required »
});

test('POST /auth/logout needs no body; form-encoded bodies and foreign origins are refused (CSRF)', async () => {
  const cookie = cookieFor('admin');
  assert.strictEqual((await call('POST', '/auth/logout', undefined, cookie)).status, 204);

  const form = await fetch(`${base}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: 'name=evil',
  });
  assert.strictEqual(form.status, 415);

  const foreign = await fetch(`${base}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://evil.example' },
    body: '{"name":"x"}',
  });
  assert.strictEqual(foreign.status, 403);

  const host = new URL(base).host;
  const same = await fetch(`${base}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: `http://${host}` },
    body: '{"name":"x"}',
  });
  assert.notStrictEqual(same.status, 403);
});
