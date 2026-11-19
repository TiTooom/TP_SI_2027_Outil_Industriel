// Instance unique du service de sessions, câblée sur la vraie base.
const env = require('../config/env');
const sessionRepo = require('../repositories/sessionRepository');
const { createSessionService } = require('./sessionService');

module.exports = createSessionService({
  sessionRepo,
  idleHours: env.sessionIdleHours,
  maxHours: env.sessionMaxHours,
});
