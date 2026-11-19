// Login, comptes, équipes et PATCH variable avec des dépôts en mémoire (aucune base de données).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

Object.assign(process.env, {
  DB_API_USER: 'api', DB_API_PASSWORD: 'x', DB_POLLER_USER: 'poller', DB_POLLER_PASSWORD: 'x',
});
const { listenOnSafePort } = require('./helpers/listen');
const { createApp } = require('../src/app');
const { createSessionService } = require('../src/services/sessionService');
const { createLoginThrottle } = require('../src/services/loginThrottle');
const { hashPassword, verifyPassword } = require('../src/services/passwordHasher');

let users;
let teams;
let sessions;
let calls;
let server;
let base;
let nextId;

// Imite les garanties atomiques du dépôt SQL (dernier admin) pour tester le mapping des routes.
const userRepo = {
  list: async () => users.map(({ password_hash: _h, ...u }) => ({ ...u, teams: [] })),
  findById: async (id) => {
    const u = users.find((x) => x.id === id);
    if (!u) return null;
    const { password_hash: _h, ...pub } = u;
    return { ...pub, teams: [] };
  },
  findCredentialsByUsername: async (name) => users.find((u) => u.username === name) || null,
  findCredentialsById: async (id) => users.find((u) => u.id === id) || null,
  create: async (u) => {
    if (users.some((x) => x.username === u.username)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    const row = { id: nextId++, username: u.username, email: u.email, role: u.role, password_hash: u.passwordHash, created_at: 'T' };
    users.push(row);
    return userRepo.findById(row.id);
  },
  setPassword: async (id, hash) => { const u = users.find((x) => x.id === id); if (u) u.password_hash = hash; return Boolean(u); },
  update: async (id, { email, role }) => {
    const u = users.find((x) => x.id === id);
    if (!u) return 'not_found';
    if (u.role === 'admin' && role && role !== 'admin' && users.filter((x) => x.role === 'admin').length <= 1) return 'last_admin';
    if (email !== undefined) u.email = email;
    if (role) u.role = role;
    return 'ok';
  },
  remove: async (id) => {
    const u = users.find((x) => x.id === id);
    if (!u) return 'not_found';
    if (u.role === 'admin' && users.filter((x) => x.role === 'admin').length <= 1) return 'last_admin';
    users = users.filter((x) => x.id !== id);
    sessions = sessions.filter((s) => s.userId !== id);
    return 'ok';
  },
};

const teamRepo = {
  list: async () => teams.map((t) => ({ ...t, member_count: 0 })),
  findById: async (id) => { const t = teams.find((x) => x.id === id); return t ? { ...t, members: [] } : null; },
  create: async (name) => {
    if (teams.some((t) => t.name === name)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    const t = { id: teams.length + 1, name, created_at: 'T' };
    teams.push(t);
    return { ...t, members: [] };
  },
  rename: async (id, name) => { const t = teams.find((x) => x.id === id); if (t) t.name = name; return Boolean(t); },
  remove: async (id) => { const n = teams.length; teams = teams.filter((t) => t.id !== id); return teams.length < n; },
  addMember: async (teamId, userId) => teams.some((t) => t.id === teamId) && users.some((u) => u.id === userId),
  removeMember: async () => {},
};

const sessionRepo = {
  insert: async (s) => { sessions.push({ ...s, created_at: s.createdAt, last_seen_at: s.lastSeenAt, expires_at: s.expiresAt }); },
  findWithUser: async (id) => {
    const s = sessions.find((x) => x.id === id);
    const u = s && users.find((x) => x.id === s.userId);
    return u ? { ...s, user_id: u.id, username: u.username, email: u.email, role: u.role } : null;
  },
  touch: async () => {},
  remove: async (id) => { sessions = sessions.filter((s) => s.id !== id); },
  removeForUser: async (uid, except) => { sessions = sessions.filter((s) => s.userId !== uid || s.id === except); },
  purgeExpired: async () => 0,
};

before(async () => {
  server = http.createServer();
  await listenOnSafePort(server);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  nextId = 1;
  calls = [];
  teams = [];
  sessions = [];
  users = [];
  for (const [username, role] of [['admin', 'admin'], ['tech', 'technician'], ['viewer', 'viewer']]) {
    await userRepo.create({ username, email: null, role, passwordHash: await hashPassword(`${username}-password-1`) });
  }
  const variableRepo = {
    patch: async (id, v) => (id === 5 ? { id: 5, plc_id: 1, ...v } : null),
  };
  const poller = { syncVariable: async (id) => { calls.push(['syncVariable', id]); } };
  const sessionService = createSessionService({ sessionRepo });
  const app = createApp({
    userRepo, teamRepo, sessionService, throttle: createLoginThrottle(), variableRepo, poller, plcRepo: {}, measureRepo: {},
    loginDelayMs: 0,
  });
  server.removeAllListeners('request');
  server.on('request', app);
});

async function login(username, password = `${username}-password-1`) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const cookie = (res.headers.getSetCookie()[0] || '').split(';')[0];
  return { res, cookie };
}

function api(cookie, method, path, body) {
  return fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('login sets a hardened cookie, returns the user without password_hash', async () => {
  const { res, cookie } = await login('admin');
  assert.strictEqual(res.status, 200);
  const header = res.headers.getSetCookie()[0];
  assert.match(header, /^sid=[0-9a-f]{64}; /);
  for (const attr of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=']) assert.ok(header.includes(attr), attr);
  const body = await res.json();
  assert.strictEqual(body.user.username, 'admin');
  assert.ok(!JSON.stringify(body).includes('password'));
  const me = await (await api(cookie, 'GET', '/auth/me')).json();
  assert.deepStrictEqual(Object.keys(me).sort(), ['email', 'id', 'role', 'teams', 'username']);
});

test('wrong password and unknown user give the same generic 401', async () => {
  const a = await login('admin', 'not-the-password');
  const b = await login('ghost', 'whatever-long-pass');
  for (const { res } of [a, b]) {
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(await res.json(), { error: 'Invalid credentials' });
  }
  assert.strictEqual(a.res.headers.getSetCookie().length, 0);
});

test('login validates input (400) and throttles after 5 failures (429 + Retry-After)', async () => {
  const bad = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin' }),
  });
  assert.strictEqual(bad.status, 400);
  for (let i = 0; i < 5; i += 1) assert.strictEqual((await login('admin', 'nope')).res.status, 401);
  const blocked = await login('admin');
  assert.strictEqual(blocked.res.status, 429);
  assert.ok(Number(blocked.res.headers.get('retry-after')) > 0);
  assert.strictEqual((await login('viewer')).res.status, 200);
});

test('logout revokes the session and expires the cookie', async () => {
  const { cookie } = await login('admin');
  const out = await api(cookie, 'POST', '/auth/logout');
  assert.strictEqual(out.status, 204);
  assert.match(out.headers.getSetCookie()[0], /Max-Age=0/);
  assert.strictEqual((await api(cookie, 'GET', '/auth/me')).status, 401);
});

test('password change: 403 on wrong current, 400 on policy, revokes other sessions only', async () => {
  const first = await login('viewer');
  const second = await login('viewer');
  const url = '/auth/password';
  assert.strictEqual((await api(first.cookie, 'POST', url, { current_password: 'bad', new_password: 'a-new-password-1' })).status, 403);
  assert.strictEqual((await api(first.cookie, 'POST', url, { current_password: 'viewer-password-1', new_password: 'short' })).status, 400);
  assert.strictEqual((await api(first.cookie, 'POST', url, { new_password: 'a-new-password-1' })).status, 400);
  assert.strictEqual((await api(first.cookie, 'POST', url, { current_password: 'viewer-password-1', new_password: 'a-new-password-1' })).status, 204);
  assert.strictEqual((await api(first.cookie, 'GET', '/auth/me')).status, 200);
  assert.strictEqual((await api(second.cookie, 'GET', '/auth/me')).status, 401);
  assert.strictEqual((await login('viewer')).res.status, 401);
  assert.strictEqual((await login('viewer', 'a-new-password-1')).res.status, 200);
});

test('admin creates users: validation, 409 duplicate, hash stored, no hash in responses', async () => {
  const { cookie } = await login('admin');
  const good = { username: 'new.user', email: 'n@x.io', password: 'long-enough-pass', role: 'engineer' };
  const created = await api(cookie, 'POST', '/users', good);
  assert.strictEqual(created.status, 201);
  const body = await created.json();
  assert.strictEqual(body.role, 'engineer');
  assert.ok(!JSON.stringify(body).includes('password'));
  assert.ok(await verifyPassword(good.password, users.find((u) => u.username === 'new.user').password_hash));
  assert.strictEqual((await api(cookie, 'POST', '/users', good)).status, 409);
  const listed = JSON.stringify(await (await api(cookie, 'GET', '/users')).json());
  assert.ok(!listed.includes('password') && !listed.includes('scrypt'));
  for (const patch of [{ username: 'ab' }, { username: 'bad name!' }, { password: 'short' }, { role: 'root' }, { email: 'nope' }]) {
    assert.strictEqual((await api(cookie, 'POST', '/users', { ...good, username: 'other1', ...patch })).status, 400, JSON.stringify(patch));
  }
});

test('last admin cannot be demoted or deleted; self-deletion is refused', async () => {
  const { cookie } = await login('admin');
  const demote = await api(cookie, 'PUT', '/users/1', { role: 'viewer' });
  assert.strictEqual(demote.status, 409);
  assert.deepStrictEqual(await demote.json(), { error: 'Cannot remove the last admin' });
  const self = await api(cookie, 'DELETE', '/users/1');
  assert.strictEqual(self.status, 409);
  assert.deepStrictEqual(await self.json(), { error: 'Cannot delete yourself' });
  // Avec un second admin, la rétrogradation est permise ; le dernier restant est de nouveau protégé.
  await api(cookie, 'PUT', '/users/2', { role: 'admin' });
  assert.strictEqual((await api(cookie, 'PUT', '/users/1', { role: 'viewer' })).status, 200);
  const { cookie: other } = await login('tech');
  assert.strictEqual((await api(other, 'PUT', '/users/2', { role: 'viewer' })).status, 409);
});

test('role change, password reset and deletion revoke the target sessions', async () => {
  const admin = await login('admin');
  const tech = await login('tech');
  assert.strictEqual((await api(admin.cookie, 'PUT', '/users/2', { role: 'engineer' })).status, 200);
  assert.strictEqual((await api(tech.cookie, 'GET', '/auth/me')).status, 401);

  const again = await login('tech');
  assert.strictEqual((await api(admin.cookie, 'PUT', '/users/2/password', { new_password: 'reset-by-admin-1' })).status, 204);
  assert.strictEqual((await api(again.cookie, 'GET', '/auth/me')).status, 401);
  assert.strictEqual((await login('tech', 'reset-by-admin-1')).res.status, 200);

  const last = await login('viewer');
  assert.strictEqual((await api(admin.cookie, 'DELETE', '/users/3')).status, 204);
  assert.strictEqual((await api(last.cookie, 'GET', '/auth/me')).status, 401);
  assert.strictEqual((await api(admin.cookie, 'GET', '/users/3')).status, 404);
});

test('user ids and bodies are validated', async () => {
  const { cookie } = await login('admin');
  assert.strictEqual((await api(cookie, 'GET', '/users/abc')).status, 400);
  assert.strictEqual((await api(cookie, 'GET', '/users/99')).status, 404);
  assert.strictEqual((await api(cookie, 'PUT', '/users/2', {})).status, 400);
  assert.strictEqual((await api(cookie, 'PUT', '/users/2', { role: 'viewer', password_hash: 'x' })).status, 400);
  assert.strictEqual((await api(cookie, 'PUT', '/users/99', { role: 'viewer' })).status, 404);
  assert.strictEqual((await api(cookie, 'PUT', '/users/2/password', { new_password: 'short' })).status, 400);
  assert.strictEqual((await api(cookie, 'PUT', '/users/99/password', { new_password: 'long-enough-pass' })).status, 404);
});

test('teams: CRUD, duplicates, memberships, invalid ids', async () => {
  const { cookie } = await login('admin');
  assert.strictEqual((await api(cookie, 'POST', '/teams', { name: '' })).status, 400);
  assert.strictEqual((await api(cookie, 'POST', '/teams', { name: 'Maintenance' })).status, 201);
  assert.strictEqual((await api(cookie, 'POST', '/teams', { name: 'Maintenance' })).status, 409);
  assert.strictEqual((await api(cookie, 'PUT', '/teams/1', { name: 'Ops' })).status, 200);
  assert.strictEqual((await api(cookie, 'GET', '/teams/1')).status, 200);
  assert.strictEqual((await api(cookie, 'PUT', '/teams/1/members/2')).status, 204);
  assert.strictEqual((await api(cookie, 'PUT', '/teams/9/members/2')).status, 404);
  assert.strictEqual((await api(cookie, 'PUT', '/teams/1/members/99')).status, 404);
  assert.strictEqual((await api(cookie, 'PUT', '/teams/x/members/2')).status, 400);
  assert.strictEqual((await api(cookie, 'DELETE', '/teams/1/members/2')).status, 204);
  assert.strictEqual((await api(cookie, 'DELETE', '/teams/1')).status, 204);
  assert.strictEqual((await api(cookie, 'GET', '/teams/1')).status, 404);
});

test('PATCH /variables/:id: technician may toggle and change frequency, nothing else', async () => {
  const { cookie } = await login('tech');
  const ok = await api(cookie, 'PATCH', '/variables/5', { enabled: false, frequency_s: 10 });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(calls, [['syncVariable', 5]]);
  for (const body of [{}, { name: 'x' }, { enabled: 'yes' }, { frequency_s: 0 }, { frequency_s: 1.5 }, { enabled: true, address: 3 }, []]) {
    assert.strictEqual((await api(cookie, 'PATCH', '/variables/5', body)).status, 400, JSON.stringify(body));
  }
  assert.strictEqual((await api(cookie, 'PATCH', '/variables/9', { enabled: true })).status, 404);
  assert.strictEqual((await api(cookie, 'PATCH', '/variables/abc', { enabled: true })).status, 400);
  const viewer = await login('viewer');
  assert.strictEqual((await api(viewer.cookie, 'PATCH', '/variables/5', { enabled: true })).status, 403);
});
