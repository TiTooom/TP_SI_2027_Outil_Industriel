const { test } = require('node:test');
const assert = require('node:assert');
const { createSessionService, hashToken } = require('../src/services/sessionService');

const H = 3600 * 1000;

// Dépôt en mémoire qui imite la jointure session + utilisateur.
function fakeRepo() {
  const rows = new Map();
  return {
    rows,
    insert: async (s) => { rows.set(s.id, { created_at: s.createdAt, last_seen_at: s.lastSeenAt, expires_at: s.expiresAt, user_id: s.userId }); },
    findWithUser: async (id) => (rows.has(id) ? { ...rows.get(id), username: 'bob', email: null, role: 'viewer' } : null),
    touch: async (id, seen, exp) => { Object.assign(rows.get(id), { last_seen_at: seen, expires_at: exp }); },
    remove: async (id) => { rows.delete(id); },
    removeForUser: async (uid, except) => { for (const [id, r] of rows) if (r.user_id === uid && id !== except) rows.delete(id); },
    purgeExpired: async (now) => { let n = 0; for (const [id, r] of rows) if (r.expires_at <= now) { rows.delete(id); n += 1; } return n; },
  };
}

function setup() {
  const clock = { t: Date.UTC(2026, 10, 19, 8, 0, 0) };
  const repo = fakeRepo();
  return { clock, repo, svc: createSessionService({ sessionRepo: repo, now: () => clock.t }) };
}

test('only the SHA-256 of the token is stored', async () => {
  const { svc, repo } = setup();
  const { token } = await svc.create(1);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual([...repo.rows.keys()], [hashToken(token)]);
  assert.ok(!repo.rows.has(token));
});

test('valid session returns the user, junk tokens return null', async () => {
  const { svc } = setup();
  const { token } = await svc.create(1);
  assert.strictEqual((await svc.validate(token)).username, 'bob');
  for (const bad of [undefined, '', 'abc', 'g'.repeat(64), '0'.repeat(64)]) assert.strictEqual(await svc.validate(bad), null);
});

test('sliding expiry: activity extends the session, 8 h of inactivity kills it', async () => {
  const { svc, clock } = setup();
  const { token } = await svc.create(1);
  for (let i = 0; i < 3; i += 1) {
    clock.t += 7 * H;
    assert.ok(await svc.validate(token), `still valid after ${7 * (i + 1)} h`);
  }
  clock.t += 8 * H;
  assert.strictEqual(await svc.validate(token), null);
});

test('absolute expiry: 24 h after creation even with constant activity', async () => {
  const { svc, clock } = setup();
  const { token } = await svc.create(1);
  for (let i = 0; i < 4; i += 1) { clock.t += 5 * H; assert.ok(await svc.validate(token)); }
  clock.t += 5 * H; // 25 h
  assert.strictEqual(await svc.validate(token), null);
});

test('expired sessions are deleted on validation and by purge', async () => {
  const { svc, clock, repo } = setup();
  const { token } = await svc.create(1);
  await svc.create(2);
  clock.t += 9 * H;
  assert.strictEqual(await svc.validate(token), null);
  assert.strictEqual(repo.rows.size, 1);
  assert.strictEqual(await svc.purge(), 1);
  assert.strictEqual(repo.rows.size, 0);
});

test('revocation: single, all of a user, all except the current one', async () => {
  const { svc } = setup();
  const a = await svc.create(1);
  const b = await svc.create(1);
  const c = await svc.create(2);
  await svc.revokeOthers(1, a.token);
  assert.ok(await svc.validate(a.token));
  assert.strictEqual(await svc.validate(b.token), null);
  await svc.revoke(a.token);
  assert.strictEqual(await svc.validate(a.token), null);
  await svc.revokeAllForUser(2);
  assert.strictEqual(await svc.validate(c.token), null);
});
