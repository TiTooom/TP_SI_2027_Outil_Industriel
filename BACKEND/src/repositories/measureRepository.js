// Lecture seule de prod.measures (pool "api", SELECT uniquement). L'écriture appartient au poller.
const { apiPool } = require('../db/pools');

// value est forcée à null en qualité "bad" : le graphique affiche un trou.
const toMeasure = (row) => ({
  ts: row.ts.toISOString(),
  value: row.quality === 'bad' || row.value === null ? null : Number(row.value),
  quality: row.quality,
});

// Dernière mesure par ts (bad comprise) ; l'id départage deux mesures de même ts.
async function findLatest(variableId) {
  const [rows] = await apiPool.query(
    `SELECT ts, value, quality FROM prod.measures WHERE variable_id = ?
     ORDER BY ts DESC, id DESC LIMIT 1`,
    [variableId],
  );
  return rows[0] ? toMeasure(rows[0]) : null;
}

// Une ligne par variable active ayant au moins une mesure. Sous-requête scalaire par variable,
// entièrement servie par l'index (variable_id, ts) (id y est implicite), puis jointure sur la clé primaire :
// coût proportionnel au nombre de variables, pas à la taille de la table (vérifié par EXPLAIN sur 200k lignes).
async function findLatestOfActiveVariables() {
  const [rows] = await apiPool.query(
    `SELECT m.variable_id, m.ts, m.value, m.quality
     FROM (
       SELECT (SELECT m2.id FROM prod.measures m2 WHERE m2.variable_id = v.id
               ORDER BY m2.ts DESC, m2.id DESC LIMIT 1) AS measure_id
       FROM config.variables v
       WHERE v.deleted_at IS NULL AND v.enabled = 1
     ) latest
     JOIN prod.measures m ON m.id = latest.measure_id
     ORDER BY m.variable_id`,
  );
  return rows.map((row) => ({ variable_id: row.variable_id, ...toMeasure(row) }));
}

// Les `limit` mesures les plus récentes de [from, to], renvoyées en ordre chronologique.
async function findRange(variableId, from, to, limit) {
  const [rows] = await apiPool.query(
    `SELECT ts, value, quality FROM prod.measures
     WHERE variable_id = ? AND ts BETWEEN ? AND ? ORDER BY ts DESC, id DESC LIMIT ?`,
    [variableId, from, to, limit],
  );
  return rows.reverse().map(toMeasure);
}

module.exports = { findLatest, findLatestOfActiveVariables, findRange };
