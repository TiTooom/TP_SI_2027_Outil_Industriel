// Seul accès du service de relevé (et d'écriture vers les automates) à la base : lecture de config.* et INSERT dans prod.measures
// (pool "poller", seul compte autorisé à écrire des mesures).
const { pollerPool } = require('../db/pools');

// Une ligne par variable à relever (variable active, non supprimée, automate actif).
async function loadActiveTargets() {
  const [rows] = await pollerPool.query(
    `SELECT v.id AS variable_id, v.register_type, v.address, v.data_type, v.scale, v.value_offset, v.frequency_s,
            p.id AS plc_id, p.name AS plc_name, p.host, p.port, p.unit_id
     FROM config.variables v
     JOIN config.plcs p ON p.id = v.plc_id
     WHERE v.enabled = 1 AND v.deleted_at IS NULL AND p.enabled = 1
     ORDER BY v.id`,
  );
  return rows;
}

// Cible d'une écriture : la variable doit être déclarée modifiable, active et sur un automate actif.
// Relue en base à chaque écriture, sur le compte « poller » (SELECT seul) : jamais de cache périmé.
async function findWritableTarget(variableId) {
  const [rows] = await pollerPool.query(
    `SELECT v.id AS variable_id, v.register_type, v.address, v.data_type, v.scale, v.value_offset,
            p.id AS plc_id, p.host, p.port, p.unit_id
     FROM config.variables v
     JOIN config.plcs p ON p.id = v.plc_id
     WHERE v.id = ? AND v.writable = 1 AND v.enabled = 1 AND v.deleted_at IS NULL AND p.enabled = 1`,
    [variableId],
  );
  return rows[0] || null;
}

async function insertMeasure({ variableId, ts, value, quality }) {
  await pollerPool.query(
    'INSERT INTO prod.measures (variable_id, ts, value, quality) VALUES (?, ?, ?, ?)',
    [variableId, ts, value, quality],
  );
}

module.exports = { loadActiveTargets, findWritableTarget, insertMeasure };
