const { test } = require('node:test');
const assert = require('node:assert');
const { createLoginThrottle, WINDOW_MS } = require('../src/services/loginThrottle');

function setup() {
  const clock = { t: 1000000 };
  return { clock, throttle: createLoginThrottle({ now: () => clock.t }) };
}

test('5 failures on the same (ip, username) block that pair for 15 minutes', () => {
  const { clock, throttle } = setup();
  for (let i = 0; i < 4; i += 1) throttle.recordFailure('1.1.1.1', 'bob');
  assert.strictEqual(throttle.check('1.1.1.1', 'bob').blocked, false);
  throttle.recordFailure('1.1.1.1', 'bob');
  const gate = throttle.check('1.1.1.1', 'Bob'); // insensible à la casse
  assert.strictEqual(gate.blocked, true);
  assert.ok(gate.retryAfterS > 0 && gate.retryAfterS <= 900);
  assert.strictEqual(throttle.check('1.1.1.1', 'alice').blocked, false);
  assert.strictEqual(throttle.check('2.2.2.2', 'bob').blocked, false);
  clock.t += WINDOW_MS;
  assert.strictEqual(throttle.check('1.1.1.1', 'bob').blocked, false);
});

test('30 failures from one IP across usernames block the whole IP', () => {
  const { throttle } = setup();
  for (let i = 0; i < 30; i += 1) throttle.recordFailure('3.3.3.3', `user${i}`);
  assert.strictEqual(throttle.check('3.3.3.3', 'fresh').blocked, true);
  assert.strictEqual(throttle.check('4.4.4.4', 'fresh').blocked, false);
});

test('a success clears the pair counter', () => {
  const { throttle } = setup();
  for (let i = 0; i < 4; i += 1) throttle.recordFailure('1.1.1.1', 'bob');
  throttle.recordSuccess('1.1.1.1', 'bob');
  throttle.recordFailure('1.1.1.1', 'bob');
  assert.strictEqual(throttle.check('1.1.1.1', 'bob').blocked, false);
});

test('20 failures on one username block it from any IP (XFF rotation), existing or not', () => {
  const { throttle } = setup();
  for (let i = 0; i < 20; i += 1) throttle.recordFailure(`10.0.0.${i}`, 'Ghost');
  assert.strictEqual(throttle.check('10.0.9.9', 'ghost').blocked, true);
  assert.strictEqual(throttle.check('10.0.9.9', 'other').blocked, false);
});
