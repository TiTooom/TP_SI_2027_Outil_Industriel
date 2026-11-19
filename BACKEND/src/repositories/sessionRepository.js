// Accès SQL aux sessions (pool "api"). `id` est le SHA-256 du jeton : le jeton lui-même n'est jamais stocké.
const { apiPool } = require('../db/pools');

async function insert({ id, userId, createdAt, lastSeenAt, expiresAt }) {
  await apiPool.query(
    'INSERT INTO app.sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, createdAt, lastSeenAt, expiresAt],
  );
}

// Jointure sur l'utilisateur : le rôle appliqué est toujours celui de la base, pas celui de la création.
async function findWithUser(id) {
  const [rows] = await apiPool.query(
    `SELECT s.created_at, s.last_seen_at, s.expires_at, u.id AS user_id, u.username, u.email, u.role
       FROM app.sessions s JOIN app.users u ON u.id = s.user_id WHERE s.id = ?`,
    [id],
  );
  return rows[0] || null;
}

async function touch(id, lastSeenAt, expiresAt) {
  await apiPool.query('UPDATE app.sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [lastSeenAt, expiresAt, id]);
}

async function remove(id) {
  await apiPool.query('DELETE FROM app.sessions WHERE id = ?', [id]);
}

// exceptId : session courante à conserver (changement de mot de passe).
async function removeForUser(userId, exceptId = null) {
  await apiPool.query('DELETE FROM app.sessions WHERE user_id = ? AND (? IS NULL OR id <> ?)', [userId, exceptId, exceptId]);
}

async function purgeExpired(now) {
  const [result] = await apiPool.query('DELETE FROM app.sessions WHERE expires_at <= ?', [now]);
  return result.affectedRows;
}

module.exports = { insert, findWithUser, touch, remove, removeForUser, purgeExpired };
