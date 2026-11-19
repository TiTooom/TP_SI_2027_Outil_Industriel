// Accès SQL aux automates (pool "api"). Requêtes paramétrées uniquement.
const { apiPool } = require('../db/pools');

const SELECT = `SELECT p.id, p.name, p.host, p.port, p.unit_id, p.enabled, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM config.variables v WHERE v.plc_id = p.id AND v.deleted_at IS NULL) AS variable_count
  FROM config.plcs p`;

const toPlc = (row) => ({ ...row, enabled: Boolean(row.enabled), variable_count: Number(row.variable_count) });

async function list() {
  const [rows] = await apiPool.query(`${SELECT} ORDER BY p.id`);
  return rows.map(toPlc);
}

async function findById(id) {
  const [rows] = await apiPool.query(`${SELECT} WHERE p.id = ?`, [id]);
  return rows[0] ? toPlc(rows[0]) : null;
}

async function create({ name, host, port, unit_id, enabled }) {
  const [result] = await apiPool.query(
    'INSERT INTO config.plcs (name, host, port, unit_id, enabled) VALUES (?, ?, ?, ?, ?)',
    [name, host, port, unit_id, enabled],
  );
  return findById(result.insertId);
}

async function update(id, { name, host, port, unit_id, enabled }) {
  await apiPool.query(
    'UPDATE config.plcs SET name = ?, host = ?, port = ?, unit_id = ?, enabled = ? WHERE id = ?',
    [name, host, port, unit_id, enabled, id],
  );
  return findById(id);
}

async function countActiveVariables(id) {
  const [rows] = await apiPool.query(
    'SELECT COUNT(*) AS n FROM config.variables WHERE plc_id = ? AND deleted_at IS NULL',
    [id],
  );
  return Number(rows[0].n);
}

async function count() {
  const [rows] = await apiPool.query('SELECT COUNT(*) AS n FROM config.plcs');
  return Number(rows[0].n);
}

async function remove(id) {
  const [result] = await apiPool.query('DELETE FROM config.plcs WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = { list, findById, create, update, countActiveVariables, count, remove };
