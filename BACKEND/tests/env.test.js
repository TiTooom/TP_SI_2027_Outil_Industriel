const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

test("CORS_ORIGIN='*' is refused at startup", () => {
  const r = spawnSync(process.execPath, ['-e', "require('./src/config/env')"], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: { ...process.env, CORS_ORIGIN: '*', DB_API_USER: 'a', DB_API_PASSWORD: 'a', DB_POLLER_USER: 'p', DB_POLLER_PASSWORD: 'p' },
    encoding: 'utf8',
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /CORS_ORIGIN=\* is not allowed/);
});
