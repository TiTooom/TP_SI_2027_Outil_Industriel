// Accès SQL aux variables (pool "api"). Les variables supprimées logiquement sont toujours exclues.
const { apiPool } = require('../db/pools');

const COLUMNS = `id, plc_id, name, register_type, address, data_type, scale, value_offset,
  COALESCE(unit, '') AS unit, frequency_s, enabled, created_at, updated_at`;

const toVariable = (row) => ({ ...row, enabled: Boolean(row.enabled) });

async function list(plcId) {
  const where = plcId === undefined ? '' : 'AND plc_id = ?';
  const params = plcId === undefined ? [] : [plcId];
  const [rows] = await apiPool.query(
    `SELECT ${COLUMNS} FROM config.variables WHERE deleted_at IS NULL ${where} ORDER BY id`,
    params,
  );
  return rows.map(toVariable);
}

async function findById(id) {
  const [rows] = await apiPool.query(
    `SELECT ${COLUMNS} FROM config.variables WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ? toVariable(rows[0]) : null;
}

async function create(v) {
  const [result] = await apiPool.query(
    `INSERT INTO config.variables
      (plc_id, name, register_type, address, data_type, scale, value_offset, unit, frequency_s, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.plc_id, v.name, v.register_type, v.address, v.data_type, v.scale, v.value_offset, v.unit, v.frequency_s, v.enabled],
  );
  return findById(result.insertId);
}

async function update(id, v) {
  await apiPool.query(
    `UPDATE config.variables SET plc_id = ?, name = ?, register_type = ?, address = ?, data_type = ?,
      scale = ?, value_offset = ?, unit = ?, frequency_s = ?, enabled = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [v.plc_id, v.name, v.register_type, v.address, v.data_type, v.scale, v.value_offset, v.unit, v.frequency_s, v.enabled, id],
  );
  return findById(id);
}

// Suppression logique. Le nom reste réutilisable : l'unicité en base (active_key) ne couvre que les lignes actives.
async function softDelete(id) {
  const [result] = await apiPool.query(
    'UPDATE config.variables SET deleted_at = NOW(), enabled = 0 WHERE id = ? AND deleted_at IS NULL',
    [id],
  );
  return result.affectedRows > 0;
}

async function count() {
  const [rows] = await apiPool.query('SELECT COUNT(*) AS n FROM config.variables WHERE deleted_at IS NULL');
  return Number(rows[0].n);
}

module.exports = { list, findById, create, update, softDelete, count };
