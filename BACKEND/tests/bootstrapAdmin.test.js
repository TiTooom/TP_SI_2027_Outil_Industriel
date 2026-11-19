const { test } = require('node:test');
const assert = require('node:assert');
const { bootstrapAdmin } = require('../src/services/bootstrapAdmin');
const { verifyPassword } = require('../src/services/passwordHasher');

const logger = () => {
  const lines = [];
  return { lines, log: (m) => lines.push(m), error: (m) => lines.push(m) };
};

test('creates the admin when the table is empty and never logs the password', async () => {
  let created;
  const log = logger();
  const userRepo = { count: async () => 0, create: async (u) => { created = u; } };
  assert.strictEqual(await bootstrapAdmin({ userRepo, username: 'admin', password: 'very-secret-pass', log }), true);
  assert.strictEqual(created.role, 'admin');
  assert.strictEqual(await verifyPassword('very-secret-pass', created.passwordHash), true);
  assert.ok(log.lines.length > 0 && log.lines.every((l) => !l.includes('very-secret-pass')));
});

test('does nothing when users already exist', async () => {
  const userRepo = { count: async () => 2, create: async () => assert.fail('must not create') };
  assert.strictEqual(await bootstrapAdmin({ userRepo, username: 'admin', password: 'very-secret-pass', log: logger() }), false);
});

test('refuses a short password and logs an error', async () => {
  const log = logger();
  const userRepo = { count: async () => 0, create: async () => assert.fail('must not create') };
  assert.strictEqual(await bootstrapAdmin({ userRepo, username: 'admin', password: 'short', log }), false);
  assert.ok(log.lines.some((l) => l.includes('ADMIN_PASSWORD')));
});

test('retries when the database is not ready, then gives up without throwing', async () => {
  let calls = 0;
  const userRepo = { count: async () => { calls += 1; throw new Error('ECONNREFUSED'); } };
  const ok = await bootstrapAdmin({ userRepo, username: 'admin', password: 'very-secret-pass', log: logger(), attempts: 3, retryDelayMs: 1 });
  assert.strictEqual(ok, false);
  assert.strictEqual(calls, 3);
});
