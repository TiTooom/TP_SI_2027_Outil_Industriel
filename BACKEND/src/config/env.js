// Lecture et validation centralisées de la configuration (variables documentées dans README.md et .env.example).
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

function positiveInt(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid value in ${name}: ${process.env[name]}`);
  }
  return value;
}

// Un joker ouvrirait l'API à n'importe quel site visité depuis le LAN (requêtes cross-origin du navigateur).
if (process.env.CORS_ORIGIN === '*') {
  throw new Error('CORS_ORIGIN=* is not allowed: set an explicit origin or leave it empty');
}

// Un fuseau invalide ferait échouer chaque export : on le détecte au démarrage.
function timeZone(name, fallback) {
  const value = process.env[name] || fallback;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
  } catch {
    throw new Error(`Invalid time zone in ${name}: ${value}`);
  }
  return value;
}

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: port('PORT', 3000),
  corsOrigin: process.env.CORS_ORIGIN || '',
  exportTz: timeZone('EXPORT_TZ', 'Europe/Paris'),
  exportMaxDays: positiveInt('EXPORT_MAX_DAYS', 31),
  exportMaxRows: positiveInt('EXPORT_MAX_ROWS', 500000),
  exportTimeoutS: positiveInt('EXPORT_TIMEOUT_S', 300),
  modbusTimeoutMs: positiveInt('MODBUS_TIMEOUT_MS', 3000),
  db: Object.freeze({
    host: process.env.DB_HOST || 'localhost',
    port: port('DB_PORT', 3306),
    api: Object.freeze({ user: required('DB_API_USER'), password: required('DB_API_PASSWORD') }),
    poller: Object.freeze({ user: required('DB_POLLER_USER'), password: required('DB_POLLER_PASSWORD') }),
  }),
});

module.exports = env;
