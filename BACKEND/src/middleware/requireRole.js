// Contrôle du rôle minimum. À placer après authenticate.
const { hasRole } = require('../config/roles');

function requireRole(min) {
  return (req, res, next) => {
    if (!hasRole(req.user.role, min)) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}

// Rôle minimum selon la méthode HTTP (matrice des droits) : { GET: 'viewer', PATCH: 'technician' }, défaut pour le reste.
function requireRoleByMethod(byMethod, fallback) {
  return (req, res, next) => {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    return requireRole(byMethod[method] || fallback)(req, res, next);
  };
}

module.exports = { requireRole, requireRoleByMethod };
