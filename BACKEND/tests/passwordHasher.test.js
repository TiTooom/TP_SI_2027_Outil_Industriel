const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, verifyDummy, passwordPolicyError } = require('../src/services/passwordHasher');

test('hash has the documented format and verifies the right password only', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.match(stored, /^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.strictEqual(await verifyPassword('correct horse battery', stored), true);
  assert.strictEqual(await verifyPassword('wrong password!!', stored), false);
});

test('two hashes of the same password differ (random salt)', async () => {
  assert.notStrictEqual(await hashPassword('same-password-1'), await hashPassword('same-password-1'));
});

test('malformed stored hashes are rejected without throwing', async () => {
  for (const bad of ['', 'plain', 'scrypt$x$aa$bb', 'bcrypt$1$aa$bb', 'scrypt$16384$$']) {
    assert.strictEqual(await verifyPassword('whatever-long', bad), false);
  }
});

test('dummy verification always fails', async () => {
  assert.strictEqual(await verifyDummy('anything-goes'), false);
});

test('password policy: 10 to 128 characters', () => {
  assert.ok(passwordPolicyError('short'));
  assert.ok(passwordPolicyError('x'.repeat(129)));
  assert.ok(passwordPolicyError(12345678901));
  assert.strictEqual(passwordPolicyError('x'.repeat(10)), null);
  assert.strictEqual(passwordPolicyError('x'.repeat(128)), null);
});
