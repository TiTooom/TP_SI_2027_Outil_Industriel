// Accès SQL aux tableaux de bord (pool "api"). Les droits sont décidés par la route.
const { apiPool } = require('../db/pools');

const COLUMNS = `d.id, d.name, d.owner_user_id, u.username AS owner_username, d.owner_team_id, t.name AS owner_team_name,
  d.created_at, d.updated_at`;
const FROM = `app.dashboards d LEFT JOIN app.users u ON u.id = d.owner_user_id LEFT JOIN app.teams t ON t.id = d.owner_team_id`;
const ORDER = 'ORDER BY (d.owner_user_id IS NULL), d.name, d.id';
const WIDGET_COUNT = `JSON_LENGTH(d.layout, '$.widgets') AS widget_count`;

// Une colonne JSON MariaDB est un LONGTEXT : selon le driver on reçoit une chaîne ou un objet.
const parseLayout = (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw);
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

function toDashboard(row) {
  const { layout, widget_count: widgetCount, ...rest } = row;
  const out = { ...rest, scope: row.owner_user_id ? 'user' : 'team', created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
  if (layout === undefined) {
    out.widget_count = Number(widgetCount);
  } else {
    out.layout = parseLayout(layout);
    out.widget_count = out.layout.widgets.length;
  }
  return out;
}

async function listForUser(userId) {
  const [rows] = await apiPool.query(
    `SELECT ${COLUMNS}, ${WIDGET_COUNT} FROM ${FROM}
      WHERE d.owner_user_id = ? OR d.owner_team_id IN (SELECT team_id FROM app.team_members WHERE user_id = ?) ${ORDER}`,
    [userId, userId],
  );
  return rows.map(toDashboard);
}

async function listAll() {
  const [rows] = await apiPool.query(`SELECT ${COLUMNS}, ${WIDGET_COUNT} FROM ${FROM} ${ORDER}`);
  return rows.map(toDashboard);
}

async function findById(id) {
  const [rows] = await apiPool.query(`SELECT ${COLUMNS}, d.layout FROM ${FROM} WHERE d.id = ?`, [id]);
  return rows[0] ? toDashboard(rows[0]) : null;
}

async function memberTeamIds(userId) {
  const [rows] = await apiPool.query('SELECT team_id FROM app.team_members WHERE user_id = ?', [userId]);
  return rows.map((r) => r.team_id);
}

async function teamExists(teamId) {
  const [rows] = await apiPool.query('SELECT 1 FROM app.teams WHERE id = ?', [teamId]);
  return rows.length > 0;
}

// Plafond par propriétaire vérifié dans l'INSERT (pas de course entre COUNT et INSERT).
// Renvoie null si `max` est atteint.
async function create({ name, layout, max, userId = null, teamId = null }) {
  const column = userId ? 'owner_user_id' : 'owner_team_id';
  const [result] = await apiPool.query(
    `INSERT INTO app.dashboards (name, owner_user_id, owner_team_id, layout)
     SELECT ?, ?, ?, ? FROM DUAL WHERE (SELECT COUNT(*) FROM app.dashboards WHERE ${column} = ?) < ?`,
    [name, userId, teamId, JSON.stringify(layout), userId || teamId, max],
  );
  return result.affectedRows ? findById(result.insertId) : null;
}

// Seuls le nom et le layout changent ; le propriétaire est figé.
async function update(id, { name, layout }) {
  const sets = [];
  const params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (layout !== undefined) { sets.push('layout = ?'); params.push(JSON.stringify(layout)); }
  await apiPool.query(`UPDATE app.dashboards SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  return findById(id);
}

async function remove(id) {
  const [result] = await apiPool.query('DELETE FROM app.dashboards WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = { listForUser, listAll, findById, memberTeamIds, teamExists, create, update, remove };
