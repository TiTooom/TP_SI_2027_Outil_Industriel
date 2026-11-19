// Lecture et validation centralisées de la configuration (voir docs/CONTRACTS.md).
// En conteneur, les variables viennent de docker-compose ; en local, de BACKEND/.env ou du .env racine.
const path = require('path');
require('dotenv').config({
  path: [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../../../.env')],
  quiet: true,
});

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid port in ${name}: ${process.env[name]}`);
  }
  return value;
}

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: port('PORT', 3000),
  corsOrigin: process.env.CORS_ORIGIN || '',
  db: Object.freeze({
    host: process.env.DB_HOST || 'localhost',
    port: port('DB_PORT', 3306),
    api: Object.freeze({ user: required('DB_API_USER'), password: required('DB_API_PASSWORD') }),
    poller: Object.freeze({ user: required('DB_POLLER_USER'), password: required('DB_POLLER_PASSWORD') }),
  }),
});

module.exports = env;
