// Routes /api/dashboards avec un dépôt en mémoire : droits, validation du layout, unicité, plafond.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

Object.assign(process.env, {
  DB_API_USER: 'api', DB_API_PASSWORD: 'x', DB_POLLER_USER: 'poller', DB_POLLER_PASSWORD: 'x',
});
const { listenOnSafePort } = require('./helpers/listen');
const { authDeps, cookieFor } = require('./helpers/fakeAuth');
const { createApp } = require('../src/app');
const { layoutError } = require('../src/validation/dashboard');

// Identifiants de fakeAuth : viewer=1, technician=2, engineer=3, admin=4. Équipe 10 : viewer et engineer ; équipe 11 : personne.
const MEMBERS = { 10: [1, 3] };
const TEAMS = { 10: 'Maintenance', 11: 'Vide' };
const USERNAMES = { 1: 'viewer', 2: 'technician', 3: 'engineer', 4: 'admin' };

let rows;
let nextId;
let server;
let base;

const dashboardRepo = {
  listForUser: async (uid) => rows.filter((d) => d.owner_user_id === uid || (MEMBERS[d.owner_team_id] || []).includes(uid)).map(strip),
  listAll: async () => rows.map(strip),
  findById: async (id) => rows.find((d) => d.id === id) || null,
  memberTeamIds: async (uid) => Object.keys(MEMBERS).filter((t) => MEMBERS[t].includes(uid)).map(Number),
  teamExists: async (id) => id in TEAMS,
  create: async ({ name, layout, max, userId = null, teamId = null }) => {
    const owned = rows.filter((d) => (userId ? d.owner_user_id === userId : d.owner_team_id === teamId)).length;
    if (owned >= max) return null;
    assertUnique(name, userId, teamId);
    const d = {
      id: nextId++, name, scope: userId ? 'user' : 'team', owner_user_id: userId, owner_username: userId ? USERNAMES[userId] : null,
      owner_team_id: teamId, owner_team_name: teamId ? TEAMS[teamId] : null, layout, widget_count: layout.widgets.length,
    };
    rows.push(d);
    return d;
  },
  update: async (id, { name, layout }) => {
    const d = rows.find((x) => x.id === id);
    if (name !== undefined) { assertUnique(name, d.owner_user_id, d.owner_team_id, id); d.name = name; }
    if (layout !== undefined) { d.layout = layout; d.widget_count = layout.widgets.length; }
    return d;
  },
  remove: async (id) => { const n = rows.length; rows = rows.filter((d) => d.id !== id); return rows.length < n; },
};

function strip({ layout: _layout, ...rest }) { return rest; }

function assertUnique(name, userId, teamId, exceptId) {
  const clash = rows.some((d) => d.id !== exceptId && d.name === name && d.owner_user_id === userId && d.owner_team_id === teamId);
  if (clash) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
}

before(async () => {
  server = http.createServer();
  await listenOnSafePort(server);
  base = `http://127.0.0.1:${server.address().port}/api/dashboards`;
});
after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  rows = [];
  nextId = 1;
  server.removeAllListeners('request');
  server.on('request', createApp(authDeps({ dashboardRepo })));
});

function call(role, method, path, body) {
  return fetch(`${base}${path}`, {
    method,
    headers: { Cookie: cookieFor(role), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const layoutOf = (...ids) => ({ version: 1, widgets: ids.map((variableId) => ({ variableId, size: 'md' })) });

test('requires a session', async () => {
  const res = await fetch(base);
  assert.strictEqual(res.status, 401);
});

test('layout validation rejects oversized, duplicated, invalid and unknown content', () => {
  assert.strictEqual(layoutError(layoutOf(1, 2, 3)), null);
  assert.strictEqual(layoutError({ version: 1, widgets: [] }), null);
  const tooMany = layoutOf(...Array.from({ length: 51 }, (_, i) => i + 1));
  assert.match(layoutError(tooMany), /at most 50/);
  assert.match(layoutError(layoutOf(1, 1)), /duplicated/);
  for (const bad of [0, -1, 1.5, '3', null]) {
    assert.match(layoutError({ version: 1, widgets: [{ variableId: bad, size: 'sm' }] }), /variableId/, String(bad));
  }
  assert.match(layoutError({ version: 1, widgets: [{ variableId: 1, size: 'xl' }] }), /size/);
  assert.match(layoutError({ version: 1, widgets: [{ variableId: 1 }] }), /size/);
  assert.match(layoutError({ version: 1, widgets: [{ variableId: 1, size: 'sm', x: 1 }] }), /unknown keys/);
  assert.strictEqual(layoutError({ version: 1, widgets: [{ variableId: 1, size: 'sm', w: 12, h: 80, color: '#4AA3ff' }] }), null);
  for (const bad of [{ color: 'red' }, { color: '#fff' }, { color: 5 }, { w: 0 }, { w: 13 }, { w: 2.5 }, { h: 79 }, { h: 601 }, { h: '200' }]) {
    assert.match(layoutError({ version: 1, widgets: [{ variableId: 1, size: 'sm', ...bad }] }), /\.(w|h|color) must/, JSON.stringify(bad));
  }
  assert.match(layoutError({ version: 1, widgets: [], extra: true }), /unknown keys/);
  assert.match(layoutError({ version: 2, widgets: [] }), /version/);
  assert.match(layoutError({ version: 1 }), /widgets/);
  assert.match(layoutError([]), /object/);
});

test('layout larger than 16 KB is rejected by the route', async () => {
  // 50 widgets valides font < 2 Ko : on gonfle avec une clé inconnue pour vérifier aussi qu'elle est refusée.
  const res = await call('viewer', 'POST', '', { name: 'Big', layout: { version: 1, widgets: [], pad: 'x'.repeat(20000) } });
  assert.strictEqual(res.status, 400);
});

test('POST creates a personal dashboard with default layout and trims the name', async () => {
  const res = await call('viewer', 'POST', '', { name: '  Cuve 1  ' });
  assert.strictEqual(res.status, 201);
  const d = await res.json();
  assert.strictEqual(d.name, 'Cuve 1');
  assert.strictEqual(d.scope, 'user');
  assert.strictEqual(d.owner_user_id, 1);
  assert.strictEqual(d.can_edit, true);
  assert.deepStrictEqual(d.layout, { version: 1, widgets: [] });
});

test('POST validates name, team_id and layout', async () => {
  for (const body of [{}, { name: '' }, { name: 'x'.repeat(101) }, { name: 'a', team_id: 0 }, { name: 'a', team_id: '10' },
    { name: 'a', layout: { version: 1, widgets: 'no' } }]) {
    assert.strictEqual((await call('admin', 'POST', '', body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
});

test('invalid ids give 400', async () => {
  for (const id of ['abc', '0', '-1']) assert.strictEqual((await call('admin', 'GET', `/${id}`)).status, 400, id);
});

test('personal dashboard of someone else is a 404 for every method, even for peers', async () => {
  const { id } = await (await call('viewer', 'POST', '', { name: 'Private' })).json();
  for (const [method, body] of [['GET'], ['PUT', { name: 'Z' }], ['DELETE']]) {
    assert.strictEqual((await call('technician', method, `/${id}`, body)).status, 404, method);
  }
  assert.deepStrictEqual(await (await call('technician', 'GET', '')).json(), []);
});

test('team dashboard: non-member gets 404, viewer member reads only, engineer member writes', async () => {
  const created = await call('engineer', 'POST', '', { name: 'Shared', team_id: 10, layout: layoutOf(1) });
  assert.strictEqual(created.status, 201);
  const { id, can_edit: canEdit } = await created.json();
  assert.strictEqual(canEdit, true);

  assert.strictEqual((await call('technician', 'GET', `/${id}`)).status, 404);
  assert.strictEqual((await call('technician', 'DELETE', `/${id}`)).status, 404);

  const read = await call('viewer', 'GET', `/${id}`);
  assert.strictEqual(read.status, 200);
  const seen = await read.json();
  assert.strictEqual(seen.can_edit, false);
  assert.strictEqual(seen.owner_team_name, 'Maintenance');
  const put = await call('viewer', 'PUT', `/${id}`, { name: 'Hacked' });
  assert.strictEqual(put.status, 403);
  assert.strictEqual((await put.json()).error, 'Insufficient role');
  assert.strictEqual((await call('viewer', 'DELETE', `/${id}`)).status, 403);

  const upd = await call('engineer', 'PUT', `/${id}`, { layout: layoutOf(1, 2) });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual((await upd.json()).widget_count, 2);
  assert.strictEqual((await call('engineer', 'DELETE', `/${id}`)).status, 204);
});

test('team dashboard creation: unknown or foreign team is 404, viewer member is 403, admin may use any team', async () => {
  assert.strictEqual((await call('engineer', 'POST', '', { name: 'a', team_id: 11 })).status, 404);
  assert.strictEqual((await call('engineer', 'POST', '', { name: 'a', team_id: 999 })).status, 404);
  assert.strictEqual((await call('technician', 'POST', '', { name: 'a', team_id: 10 })).status, 404);
  assert.strictEqual((await call('viewer', 'POST', '', { name: 'a', team_id: 10 })).status, 403);
  assert.strictEqual((await call('admin', 'POST', '', { name: 'a', team_id: 11 })).status, 201);
  assert.strictEqual((await call('admin', 'POST', '', { name: 'a', team_id: 999 })).status, 404);
});

test('admin sees and edits everything', async () => {
  const { id } = await (await call('viewer', 'POST', '', { name: 'Mine' })).json();
  const read = await call('admin', 'GET', `/${id}`);
  assert.strictEqual(read.status, 200);
  assert.strictEqual((await read.json()).can_edit, true);
  assert.strictEqual((await call('admin', 'PUT', `/${id}`, { name: 'Renamed' })).status, 200);
  assert.strictEqual((await call('admin', 'GET', '')).status, 200);
  assert.strictEqual((await call('admin', 'DELETE', `/${id}`)).status, 204);
  assert.strictEqual((await call('admin', 'GET', `/${id}`)).status, 404);
});

test('list omits layout and carries widget_count', async () => {
  await call('viewer', 'POST', '', { name: 'A', layout: layoutOf(1, 2) });
  const list = await (await call('viewer', 'GET', '')).json();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].widget_count, 2);
  assert.ok(!('layout' in list[0]));
});

test('PUT needs at least one field and never changes the owner', async () => {
  const { id } = await (await call('viewer', 'POST', '', { name: 'Own' })).json();
  assert.strictEqual((await call('viewer', 'PUT', `/${id}`, {})).status, 400);
  const res = await call('viewer', 'PUT', `/${id}`, { name: 'Own2', team_id: 10, owner_user_id: 2 });
  assert.strictEqual(res.status, 200);
  const d = await res.json();
  assert.strictEqual(d.owner_user_id, 1);
  assert.strictEqual(d.owner_team_id, null);
});

test('duplicate name per owner gives 409, same name for another owner is fine', async () => {
  assert.strictEqual((await call('viewer', 'POST', '', { name: 'Same' })).status, 201);
  const dup = await call('viewer', 'POST', '', { name: 'Same' });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual((await dup.json()).error, 'Dashboard name already used');
  assert.strictEqual((await call('technician', 'POST', '', { name: 'Same' })).status, 201);

  const { id } = await (await call('viewer', 'POST', '', { name: 'Other' })).json();
  assert.strictEqual((await call('viewer', 'PUT', `/${id}`, { name: 'Same' })).status, 409);
});

test('at most 20 dashboards per owner', async () => {
  for (let i = 0; i < 20; i++) assert.strictEqual((await call('viewer', 'POST', '', { name: `D${i}` })).status, 201);
  assert.strictEqual((await call('viewer', 'POST', '', { name: 'D20' })).status, 409);
  assert.strictEqual((await call('technician', 'POST', '', { name: 'D0' })).status, 201);
});
