// Accès SQL aux comptes (pool "api"). password_hash n'est exposé que par findCredentials().
const { apiPool } = require('../db/pools');

const PUBLIC_COLUMNS = 'id, username, email, role, created_at';

async function withTeams(users) {
  if (users.length === 0) return users;
  const [rows] = await apiPool.query(
    `SELECT tm.user_id, t.id, t.name FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id
      WHERE tm.user_id IN (?) ORDER BY t.name`,
    [users.map((u) => u.id)],
  );
  return users.map((u) => ({
    ...u,
    teams: rows.filter((r) => r.user_id === u.id).map((r) => ({ id: r.id, name: r.name })),
  }));
}

async function list() {
  const [rows] = await apiPool.query(`SELECT ${PUBLIC_COLUMNS} FROM app.users ORDER BY username`);
  return withTeams(rows);
}

async function findById(id) {
  const [rows] = await apiPool.query(`SELECT ${PUBLIC_COLUMNS} FROM app.users WHERE id = ?`, [id]);
  return rows[0] ? (await withTeams(rows))[0] : null;
}

// Seul point de lecture du hash : réservé au login et au changement de mot de passe.
async function findCredentials(where, value) {
  const column = where === 'id' ? 'id' : 'username';
  const [rows] = await apiPool.query(
    `SELECT id, username, role, password_hash FROM app.users WHERE ${column} = ?`,
    [value],
  );
  return rows[0] || null;
}
const findCredentialsByUsername = (username) => findCredentials('username', username);
const findCredentialsById = (id) => findCredentials('id', id);

async function count() {
  const [rows] = await apiPool.query('SELECT COUNT(*) AS n FROM app.users');
  return Number(rows[0].n);
}

async function create({ username, email, passwordHash, role }) {
  const [result] = await apiPool.query(
    'INSERT INTO app.users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [username, email, passwordHash, role],
  );
  return findById(result.insertId);
}

async function setPassword(id, passwordHash) {
  const [result] = await apiPool.query('UPDATE app.users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  return result.affectedRows > 0;
}

// Transaction : verrouille le compte visé et tous les admins pour qu'aucune opération concurrente
// ne puisse retirer le dernier admin.
async function guardedChange(id, demotesOrDeletes, apply) {
  const conn = await apiPool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT id, role FROM app.users WHERE role = 'admin' OR id = ? FOR UPDATE", [id]);
    const target = rows.find((r) => r.id === id);
    if (!target) { await conn.rollback(); return 'not_found'; }
    const admins = rows.filter((r) => r.role === 'admin').length;
    if (target.role === 'admin' && demotesOrDeletes(target) && admins <= 1) {
      await conn.rollback();
      return 'last_admin';
    }
    await apply(conn);
    await conn.commit();
    return 'ok';
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// Renvoie 'ok' | 'not_found' | 'last_admin'. email : undefined = inchangé, null = effacé.
function update(id, { email, role }) {
  return guardedChange(id, () => role !== undefined && role !== 'admin', async (conn) => {
    const sets = [];
    const params = [];
    if (email !== undefined) { sets.push('email = ?'); params.push(email); }
    if (role !== undefined) { sets.push('role = ?'); params.push(role); }
    if (sets.length > 0) await conn.query(`UPDATE app.users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  });
}

function remove(id) {
  return guardedChange(id, () => true, (conn) => conn.query('DELETE FROM app.users WHERE id = ?', [id]));
}

module.exports = {
  list, findById, findCredentialsByUsername, findCredentialsById, count, create, setPassword, update, remove,
};
