// Diffusion du CSV : lecture par flux, écriture par blocs avec contre-pression (mémoire bornée).
const { once } = require('node:events');
const env = require('../config/env');
const { roundValue } = require('./roundValue');
const csv = require('./csvWriter');

const FLUSH_BYTES = 64 * 1024;
const compact = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const filenameFor = (from, to) => `export_${compact(from)}_${compact(to)}.csv`;

// Retourne { rows } ou { error } (400) ; ne produit aucun octet de CSV.
async function checkRows(measureRepo, ids, from, to) {
  const rows = await measureRepo.countRange(ids, from, to);
  if (rows > env.exportMaxRows) {
    return { error: `Too many rows (${rows} > ${env.exportMaxRows}), narrow the range or select fewer variables` };
  }
  return { rows };
}

// Plafond d'exports simultanés : chaque export garde une connexion MariaDB ouverte pendant tout le flux.
const MAX_CONCURRENT = 3;
const RETRY_AFTER_S = 5;
let active = 0;

// Retourne une fonction de libération idempotente, ou null si tous les créneaux sont pris.
function acquireSlot() {
  if (active >= MAX_CONCURRENT) return null;
  active += 1;
  let released = false;
  return () => { if (!released) { released = true; active -= 1; } };
}

async function streamCsv({ measureRepo, variables, ids, from, to, res }) {
  const byId = new Map(variables.map((v) => [v.id, v]));
  const formatLocal = csv.createLocalFormatter(env.exportTz);
  const { stream, cancel } = await measureRepo.openRangeStream(ids, from, to);
  // Client parti pendant l'ouverture du flux : 'close' est déjà passé, on libère la connexion tout de suite.
  if (res.destroyed) { cancel(); return; }

  let aborted = false;
  const abort = () => { if (!aborted) { aborted = true; cancel(); } };
  const closed = new Promise((resolve) => res.once('close', () => { abort(); resolve(); }));
  const timer = setTimeout(() => { abort(); res.destroy(); }, env.exportTimeoutS * 1000);

  res.status(200).set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filenameFor(from, to)}"`,
    'Cache-Control': 'no-store',
  });

  // Attendre aussi 'close' : un client parti ne déclenchera jamais 'drain'.
  const flush = async (chunk) => {
    if (!res.write(chunk)) await Promise.race([once(res, 'drain').catch(() => {}), closed]);
  };
  try {
    let buffer = csv.headerLine();
    for await (const row of stream) {
      if (aborted) break;
      const v = byId.get(row.variable_id);
      const bad = row.quality === 'bad' || row.value === null;
      buffer += csv.dataLine({
        local: formatLocal(row.ts), ts: row.ts, plcName: v.plc_name, variableName: v.name,
        value: bad ? null : roundValue(Number(row.value), v), unit: v.unit, quality: row.quality,
      });
      if (buffer.length >= FLUSH_BYTES) { await flush(buffer); buffer = ''; }
    }
    if (!aborted) res.end(buffer);
  } catch (err) {
    abort();
    console.error(`CSV export stream failed: ${err.message}`);
    // Avant le premier octet on peut encore répondre en JSON ; ensuite on coupe (téléchargement échoué).
    if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
    else res.destroy();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { acquireSlot, RETRY_AFTER_S, MAX_CONCURRENT, checkRows, streamCsv, filenameFor };
