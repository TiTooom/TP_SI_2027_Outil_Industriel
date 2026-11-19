const { Router } = require('express');
const asyncHandler = require('./asyncHandler');
const { createAuthenticate } = require('../middleware/authenticate');
const { setSessionCookie, clearSessionCookie } = require('../middleware/cookies');
const { verifyPassword, verifyDummy, hashPassword } = require('../services/passwordHasher');
const { password: validatePassword } = require('../validation/user');
const { isPlainObject } = require('../validation/common');

const FAIL_DELAY_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validateLogin(body) {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return { error: 'username and password are required' };
  }
  if (username.length > 50 || password.length > 128) return { error: 'username or password too long' };
  return { value: { username, password } };
}

// POST /login est la seule route publique ; le reste exige une session.
function createAuthRouter({ userRepo, sessionService, throttle, loginDelayMs = FAIL_DELAY_MS }) {
  const router = Router();
  const authenticate = createAuthenticate(sessionService);

  router.post('/login', asyncHandler(async (req, res) => {
    const { value, error } = validateLogin(req.body);
    if (error) return res.status(400).json({ error });
    const { username, password } = value;

    const gate = throttle.check(req.ip, username);
    if (gate.blocked) {
      res.set('Retry-After', String(gate.retryAfterS));
      return res.status(429).json({ error: 'Too many attempts, retry later' });
    }

    const creds = await userRepo.findCredentialsByUsername(username);
    const ok = creds ? await verifyPassword(password, creds.password_hash) : await verifyDummy(password);
    if (!ok) {
      throttle.recordFailure(req.ip, username);
      await sleep(loginDelayMs);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    throttle.recordSuccess(req.ip, username);
    const session = await sessionService.create(creds.id);
    setSessionCookie(res, session.token, session.maxAgeS);
    res.json({ user: await userRepo.findById(creds.id) });
  }));

  router.post('/logout', authenticate, asyncHandler(async (req, res) => {
    await sessionService.revoke(req.sessionToken);
    clearSessionCookie(res);
    res.status(204).end();
  }));

  router.get('/me', authenticate, asyncHandler(async (req, res) => {
    const user = await userRepo.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const { id, username, email, role, teams } = user;
    res.json({ id, username, email, role, teams });
  }));

  router.post('/password', authenticate, asyncHandler(async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    if (typeof body.current_password !== 'string' || !body.current_password) {
      return res.status(400).json({ error: 'current_password is required' });
    }
    const policy = validatePassword(body, 'new_password');
    if (policy.error) return res.status(400).json({ error: policy.error });
    const creds = await userRepo.findCredentialsById(req.user.id);
    // 403 et non 401 : le frontend redirige vers le login sur 401.
    if (!creds || !(await verifyPassword(body.current_password, creds.password_hash))) {
      return res.status(403).json({ error: 'Wrong current password' });
    }
    await userRepo.setPassword(req.user.id, await hashPassword(body.new_password));
    await sessionService.revokeOthers(req.user.id, req.sessionToken);
    res.status(204).end();
  }));

  return router;
}

module.exports = { createAuthRouter };
