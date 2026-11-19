// Cookie sid -> req.user. 401 si la session est absente, inconnue ou expirée.
const asyncHandler = require('../routes/asyncHandler');
const { readCookie } = require('./cookies');

function createAuthenticate(sessionService) {
  return asyncHandler(async (req, res, next) => {
    const token = readCookie(req);
    const user = token ? await sessionService.validate(token) : null;
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.user = user;
    req.sessionToken = token;
    next();
  });
}

module.exports = { createAuthenticate };
