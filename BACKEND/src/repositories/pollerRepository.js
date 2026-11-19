// Seul accès du service de relevé à la base : lecture de config.* et INSERT dans prod.measures
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

async function insertMeasure({ variableId, ts, value, quality }) {
  await pollerPool.query(
    'INSERT INTO prod.measures (variable_id, ts, value, quality) VALUES (?, ?, ?, ?)',
    [variableId, ts, value, quality],
  );
}

module.exports = { loadActiveTargets, insertMeasure };
