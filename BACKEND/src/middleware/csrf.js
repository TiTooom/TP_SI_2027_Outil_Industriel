// Défense CSRF en complément de SameSite=Strict : les méthodes qui modifient l'état exigent un corps JSON
// (un formulaire HTML cross-site ne peut pas en envoyer) et une Origin cohérente avec l'hôte.
const env = require('../config/env');

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hasBody(req) {
  return Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
}

// nginx transmet `Host: $host` (sans port) : on accepte donc l'hôte avec ou sans port.
function originMatchesHost(origin, host) {
  try {
    const url = new URL(origin);
    return url.host === host || url.hostname === host;
  } catch {
    return false;
  }
}

function csrfGuard(req, res, next) {
  if (!UNSAFE.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== env.corsOrigin && !originMatchesHost(origin, req.headers.host)) {
    return res.status(403).json({ error: 'Cross-origin request refused' });
  }
  if (hasBody(req) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
}

module.exports = { csrfGuard };
