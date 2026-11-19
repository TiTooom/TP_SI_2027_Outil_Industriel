// Accès SQL aux équipes et à leurs membres (pool "api").
const { apiPool } = require('../db/pools');

async function list() {
  const [rows] = await apiPool.query(
    `SELECT t.id, t.name, t.created_at, COUNT(tm.user_id) AS member_count
       FROM app.teams t LEFT JOIN app.team_members tm ON tm.team_id = t.id
      GROUP BY t.id, t.name, t.created_at ORDER BY t.name`,
  );
  return rows.map((r) => ({ ...r, member_count: Number(r.member_count) }));
}

async function findById(id) {
  const [teams] = await apiPool.query('SELECT id, name, created_at FROM app.teams WHERE id = ?', [id]);
  if (!teams[0]) return null;
  const [members] = await apiPool.query(
    `SELECT u.id, u.username, u.role FROM app.team_members tm JOIN app.users u ON u.id = tm.user_id
      WHERE tm.team_id = ? ORDER BY u.username`,
    [id],
  );
  return { ...teams[0], members };
}

async function create(name) {
  const [result] = await apiPool.query('INSERT INTO app.teams (name) VALUES (?)', [name]);
  return findById(result.insertId);
}

async function rename(id, name) {
  const [result] = await apiPool.query('UPDATE app.teams SET name = ? WHERE id = ?', [name, id]);
  // affectedRows vaut 0 si le nom est inchangé : on revérifie l'existence.
  return result.affectedRows > 0 || (await findById(id)) !== null;
}

async function remove(id) {
  const [result] = await apiPool.query('DELETE FROM app.teams WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

// Idempotent. Renvoie false si l'équipe ou l'utilisateur n'existe pas.
async function addMember(teamId, userId) {
  const [result] = await apiPool.query(
    `INSERT IGNORE INTO app.team_members (team_id, user_id)
       SELECT t.id, u.id FROM app.teams t JOIN app.users u ON u.id = ? WHERE t.id = ?`,
    [userId, teamId],
  );
  if (result.affectedRows > 0) return true;
  const [rows] = await apiPool.query(
    'SELECT 1 FROM app.teams t JOIN app.users u ON u.id = ? WHERE t.id = ?',
    [userId, teamId],
  );
  return rows.length > 0;
}

async function removeMember(teamId, userId) {
  await apiPool.query('DELETE FROM app.team_members WHERE team_id = ? AND user_id = ?', [teamId, userId]);
}

module.exports = { list, findById, create, rename, remove, addMember, removeMember };
