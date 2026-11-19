// Hiérarchie des rôles : chaque rôle hérite des droits du précédent.
const ROLES = Object.freeze(['viewer', 'technician', 'engineer', 'admin']);

const hasRole = (role, min) => ROLES.indexOf(role) >= ROLES.indexOf(min);

module.exports = { ROLES, hasRole };
