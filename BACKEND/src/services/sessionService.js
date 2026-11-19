// Sessions serveur : jeton aléatoire côté client, SHA-256 seul en base, expiration glissante + absolue.
const crypto = require('node:crypto');

const HOUR_MS = 3600 * 1000;
const PURGE_INTERVAL_MS = HOUR_MS;
// On évite une écriture SQL par requête : la fenêtre glissante n'est prolongée qu'au-delà de ce délai.
const TOUCH_AFTER_MS = 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{64}$/;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function createSessionService({ sessionRepo, idleHours = 8, maxHours = 24, now = Date.now }) {
  const idleMs = idleHours * HOUR_MS;
  const maxMs = maxHours * HOUR_MS;
  const expiryFor = (createdAt, seenAt) => new Date(Math.min(seenAt + idleMs, createdAt + maxMs));

  async function create(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const t = now();
    const expiresAt = expiryFor(t, t);
    await sessionRepo.insert({ id: hashToken(token), userId, createdAt: new Date(t), lastSeenAt: new Date(t), expiresAt });
    return { token, expiresAt, maxAgeS: Math.floor((expiresAt.getTime() - t) / 1000) };
  }

  // Renvoie { id, username, email, role } ou null (jeton absent, inconnu ou expiré).
  async function validate(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const id = hashToken(token);
    const row = await sessionRepo.findWithUser(id);
    if (!row) return null;
    const t = now();
    const created = new Date(row.created_at).getTime();
    const lastSeen = new Date(row.last_seen_at).getTime();
    if (t >= new Date(row.expires_at).getTime() || t >= created + maxMs || t >= lastSeen + idleMs) {
      await sessionRepo.remove(id);
      return null;
    }
    if (t - lastSeen >= TOUCH_AFTER_MS) await sessionRepo.touch(id, new Date(t), expiryFor(created, t));
    return { id: row.user_id, username: row.username, email: row.email, role: row.role };
  }

  const revoke = (token) => (TOKEN_RE.test(String(token)) ? sessionRepo.remove(hashToken(token)) : Promise.resolve());
  const revokeAllForUser = (userId) => sessionRepo.removeForUser(userId);
  const revokeOthers = (userId, token) => sessionRepo.removeForUser(userId, hashToken(token));
  const purge = () => sessionRepo.purgeExpired(new Date(now()));

  // Purge au démarrage puis toutes les heures ; une BDD indisponible ne doit pas faire tomber le processus.
  function startPurgeJob() {
    const run = () => purge().catch((err) => console.error('Session purge failed:', err.message));
    run();
    const timer = setInterval(run, PURGE_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { create, validate, revoke, revokeAllForUser, revokeOthers, purge, startPurgeJob };
}

module.exports = { createSessionService, hashToken };
