// Dépendances d'authentification factices : un jeton par rôle, aucune base de données.
const { ROLES } = require('../../src/config/roles');
const { createLoginThrottle } = require('../../src/services/loginThrottle');

const tokenFor = (role) => `fake-${role}`;
const cookieFor = (role) => `sid=${tokenFor(role)}`;

function fakeSessionService() {
  const users = new Map(ROLES.map((role, i) => [tokenFor(role), { id: i + 1, username: role, email: null, role }]));
  return {
    validate: async (token) => users.get(token) || null,
    create: async () => ({ token: 'x', maxAgeS: 60 }),
    revoke: async () => {},
    revokeAllForUser: async () => {},
    revokeOthers: async () => {},
  };
}

function authDeps(extra = {}) {
  return { sessionService: fakeSessionService(), userRepo: {}, teamRepo: {}, throttle: createLoginThrottle(), ...extra };
}

// Fait envoyer le cookie du rôle donné à tous les fetch de ce processus de test (sauf si un Cookie est fourni).
function installAuthFetch(role = 'admin') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (!headers.has('Cookie')) headers.set('Cookie', cookieFor(role));
    return realFetch(url, { ...init, headers });
  };
  return realFetch;
}

module.exports = { authDeps, installAuthFetch, cookieFor, tokenFor };
