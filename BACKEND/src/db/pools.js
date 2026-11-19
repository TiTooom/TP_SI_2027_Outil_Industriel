// Deux pools distincts = deux comptes SQL aux droits différents.
// - api    : CRUD config/app, lecture seule sur prod
// - poller : lecture config, INSERT sur prod.measures uniquement
// Pas de base par défaut : les requêtes utilisent des noms qualifiés (config.plcs, prod.measures…).
const mysql = require('mysql2/promise');
const env = require('../config/env');

function createPool({ user, password }) {
  return mysql.createPool({
    host: env.db.host,
    port: env.db.port,
    user,
    password,
    connectionLimit: 10,
    waitForConnections: true,
    connectTimeout: 5000,
    timezone: 'Z',
    dateStrings: false,
  });
}

const apiPool = createPool(env.db.api);
const pollerPool = createPool(env.db.poller);

async function closePools() {
  await Promise.allSettled([apiPool.end(), pollerPool.end()]);
}

module.exports = { apiPool, pollerPool, closePools };
