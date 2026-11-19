// Accès SQL aux variables (pool "api"). Les variables supprimées logiquement sont toujours exclues.
const { apiPool } = require('../db/pools');

const COLUMNS = `id, plc_id, name, register_type, address, data_type, scale, value_offset,
  COALESCE(unit, '') AS unit, frequency_s, enabled, created_at, updated_at`;

const toVariable = (row) => ({ ...row, enabled: Boolean(row.enabled) });

// Variables supprimées incluses (historique exportable) : plc_name et deleted_at ISO (null si active).
const WITH_DELETED = `SELECT v.id, v.plc_id, v.name, v.register_type, v.address, v.data_type, v.scale, v.value_offset,
  COALESCE(v.unit, '') AS unit, v.frequency_s, v.enabled, v.created_at, v.updated_at, v.deleted_at, p.name AS plc_name
  FROM config.variables v JOIN config.plcs p ON p.id = v.plc_id`;

const toVariableWithDeleted = (row) => ({
  ...toVariable(row),
  deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
});

async function list(plcId, includeDeleted = false) {
  const params = plcId === undefined ? [] : [plcId];
  if (includeDeleted) {
    const where = plcId === undefined ? '' : 'WHERE v.plc_id = ?';
    const [rows] = await apiPool.query(`${WITH_DELETED} ${where} ORDER BY v.id`, params);
    return rows.map(toVariableWithDeleted);
  }
  const where = plcId === undefined ? '' : 'AND plc_id = ?';
  const [rows] = await apiPool.query(
    `SELECT ${COLUMNS} FROM config.variables WHERE deleted_at IS NULL ${where} ORDER BY id`,
    params,
  );
  return rows.map(toVariable);
}

async function findByIdIncludingDeleted(id) {
  const [rows] = await apiPool.query(`${WITH_DELETED} WHERE v.id = ?`, [id]);
  return rows[0] ? toVariableWithDeleted(rows[0]) : null;
}

// L'appelant compare avec les ids demandés pour détecter les inconnus.
async function findManyIncludingDeleted(ids) {
  const [rows] = await apiPool.query(`${WITH_DELETED} WHERE v.id IN (?) ORDER BY v.id`, [ids]);
  return rows.map(toVariableWithDeleted);
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

// Mise à jour partielle (exploitation) : enabled et/ou frequency_s uniquement.
async function patch(id, { enabled, frequency_s: frequencyS }) {
  const sets = [];
  const params = [];
  if (enabled !== undefined) { sets.push('enabled = ?'); params.push(enabled); }
  if (frequencyS !== undefined) { sets.push('frequency_s = ?'); params.push(frequencyS); }
  await apiPool.query(`UPDATE config.variables SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, [...params, id]);
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

module.exports = { list, findById, findByIdIncludingDeleted, findManyIncludingDeleted, create, update, patch, softDelete, count };
