// E2E manuel (non lancé par npm test) : node BACKEND/tests/e2e/e2e.js
// Prérequis : `docker compose up -d --build` depuis la racine du dépôt.
const { execSync, execFileSync } = require('node:child_process');
const path = require('node:path');

const API = process.env.E2E_API || 'http://localhost:3000/api';
const NGINX = process.env.E2E_NGINX || 'http://localhost:8080/api';
const ROOT = path.resolve(__dirname, '../../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${ok ? '' : detail}`);
}

async function call(method, url, body, raw) {
  const res = await fetch(url, {
    method,
    headers: raw !== undefined ? { 'Content-Type': 'application/json' } : body ? { 'Content-Type': 'application/json' } : {},
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corps non JSON */ }
  return { status: res.status, json };
}

function sql(query) {
  // Requête passée par stdin : évite tout problème de quoting selon le shell.
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'sh', '-c', 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot -N'],
    { cwd: ROOT, input: query },
  ).toString().trim();
}
const count = (id, quality) =>
  Number(sql(`SELECT COUNT(*) FROM prod.measures WHERE variable_id=${id}${quality ? ` AND quality='${quality}'` : ''}`));

const compose = (c) => execSync(`docker compose ${c}`, { cwd: ROOT, stdio: 'pipe' });

async function main() {
  const base = { plc_id: 1, register_type: 'holding', address: 0, data_type: 'int16', scale: 0.1, unit: 'C', frequency_s: 1 };
  const name = `e2e-${Date.now()}`;

  // CRUD + cron dynamique
  let r = await call('POST', `${API}/variables`, { ...base, name });
  check('POST variable 201', r.status === 201, JSON.stringify(r));
  const id = r.json.id;
  await sleep(6000);
  const n1 = count(id, 'good');
  check('variable relevée sans redémarrage', n1 >= 3, `n=${n1}`);

  r = await call('PUT', `${API}/variables/${id}`, { ...base, name, frequency_s: 4 });
  check('PUT frequency 200', r.status === 200, JSON.stringify(r));
  await sleep(1500);
  const a = count(id);
  await sleep(12000);
  const delta = count(id) - a;
  check('cadence 4 s (12 s -> ~3 lignes)', delta >= 2 && delta <= 4, `delta=${delta}`);

  r = await call('DELETE', `${API}/variables/${id}`);
  check('DELETE 204', r.status === 204, JSON.stringify(r));
  const b = count(id);
  await sleep(6000);
  check('plus relevée après DELETE', count(id) === b);
  check('historique conservé', b > 0);
  r = await call('GET', `${API}/variables/${id}`);
  check('GET supprimée 404', r.status === 404);
  r = await call('POST', `${API}/variables`, { ...base, name });
  check('réutilisation du nom 201', r.status === 201, JSON.stringify(r));
  const id2 = r.json && r.json.id;
  r = await call('POST', `${API}/variables`, { ...base, name });
  check('doublon 409', r.status === 409, JSON.stringify(r));
  if (id2) await call('DELETE', `${API}/variables/${id2}`);

  // Validations
  const bad = async (label, method, url, body, expected, raw) => {
    const x = await call(method, url, body, raw);
    check(`${label} -> ${expected}`, x.status === expected && x.json && typeof x.json.error === 'string', `${x.status} ${JSON.stringify(x.json)}`);
  };
  const plc = { name: 'e2e-plc', host: 'simulator', port: 5020 };
  await bad('plc port 0', 'POST', `${API}/plcs`, { ...plc, port: 0 }, 400);
  await bad('plc port 70000', 'POST', `${API}/plcs`, { ...plc, port: 70000 }, 400);
  await bad('plc host IP malformée', 'POST', `${API}/plcs`, { ...plc, host: '999.1.1.1.1' }, 400);
  for (const h of ['127.0.0.1', 'localhost', 'db']) {
    await bad(`plc host interdit ${h}`, 'POST', `${API}/plcs`, { ...plc, name: 'e2e-h', host: h }, 400);
  }
  await bad('var address 70000', 'POST', `${API}/variables`, { ...base, name: 'x', address: 70000 }, 400);
  await bad('var frequency 0', 'POST', `${API}/variables`, { ...base, name: 'x', frequency_s: 0 }, 400);
  await bad('var frequency -1', 'POST', `${API}/variables`, { ...base, name: 'x', frequency_s: -1 }, 400);
  await bad('var coil + int16', 'POST', `${API}/variables`, { ...base, name: 'x', register_type: 'coil' }, 400);
  await bad('var holding + bool', 'POST', `${API}/variables`, { ...base, name: 'x', data_type: 'bool' }, 400);
  await bad('var plc inexistant', 'POST', `${API}/variables`, { ...base, name: 'x', plc_id: 9999 }, 400);
  await bad('JSON invalide', 'POST', `${API}/variables`, null, 400, '{bad json');
  await bad('id non entier', 'GET', `${API}/variables/abc`, null, 400);
  await bad('variable 404', 'GET', `${API}/variables/99999`, null, 404);
  await bad('plc 404', 'GET', `${API}/plcs/99999`, null, 404);
  await bad('DELETE plc avec variables 409', 'DELETE', `${API}/plcs/1`, null, 409);
  await bad('plc doublon 409', 'POST', `${API}/plcs`, { ...plc, name: 'Simulateur' }, 409);

  // J3 : lecture des mesures
  r = await call('POST', `${API}/variables`, { ...base, name: `e2e-j3-${Date.now()}` });
  const jid = r.json && r.json.id;
  r = await call('GET', `${API}/variables/${jid}/latest`);
  // Le poller lit dès la création : la 1re mesure peut déjà exister (course), les deux issues sont valides.
  check('latest juste après création -> 404 No measure yet ou 200',
    (r.status === 404 && r.json.error === 'No measure yet') || (r.status === 200 && r.json.quality === 'good'), JSON.stringify(r));
  await sleep(4500);
  const isoMs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  r = await call('GET', `${API}/variables/${jid}/latest`);
  check('latest 200 (ts ISO UTC ms)', r.status === 200 && isoMs.test(r.json.ts) && r.json.quality === 'good', JSON.stringify(r));
  r = await call('GET', `${API}/variables/latest`);
  check('latest groupée contient la variable', r.status === 200 && Array.isArray(r.json) && r.json.some((x) => x.variable_id === jid));
  r = await call('GET', `${NGINX}/variables/latest`);
  check('latest groupée via nginx', r.status === 200 && Array.isArray(r.json));
  r = await call('GET', `${API}/variables/${jid}/measures`);
  const ms = (r.json && r.json.measures) || [];
  check('measures défaut : count cohérent', r.status === 200 && ms.length >= 3 && r.json.count === ms.length, JSON.stringify(r.json));
  check('measures triées croissant', ms.every((m, i) => i === 0 || ms[i - 1].ts <= m.ts));
  // `to` figé : sinon une mesure arrivée entre les deux appels décale la fenêtre.
  const frozenTo = encodeURIComponent(r.json.to);
  const full = (await call('GET', `${API}/variables/${jid}/measures?to=${frozenTo}`)).json.measures;
  r = await call('GET', `${API}/variables/${jid}/measures?to=${frozenTo}&limit=2`);
  check('measures limit=2 : les 2 plus récentes', r.json.count === 2 && r.json.measures[0].ts === full[full.length - 2].ts);
  const jbad = async (label, q) => {
    const x = await call('GET', `${API}/variables/${jid}/measures?${q}`);
    check(`measures ${label} -> 400`, x.status === 400 && x.json && typeof x.json.error === 'string', `${x.status}`);
  };
  await jbad('date impossible', 'from=2026-02-31T10:00:00Z');
  await jbad('limit 0', 'limit=0');
  await jbad('limit 5001', 'limit=5001');
  await jbad('date sans fuseau', 'from=2026-11-19T10:00:00');
  await jbad('from >= to', 'from=2026-11-19T11:00:00Z&to=2026-11-19T10:00:00Z');
  await jbad('plage > 7 j', 'from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z');
  r = await call('GET', `${API}/variables/99999/measures`);
  check('measures variable inconnue -> 404', r.status === 404);
  await call('DELETE', `${API}/variables/${jid}`);
  r = await call('GET', `${API}/variables/latest`);
  check('variable supprimée absente de latest', Array.isArray(r.json) && !r.json.some((x) => x.variable_id === jid));

  // J4 : export CSV, arrondi, variables supprimées (mesures de test insérées via root, loin dans le passé)
  const EX = `${API}/export.csv`;
  const callRaw = async (url) => {
    const res = await fetch(url);
    return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  };
  const mkVar = async (n, extra) => (await call('POST', `${API}/variables`, { ...base, address: 20, enabled: false, name: n, ...extra })).json.id;
  const fid = await mkVar('=e2e-formule', { unit: '+u' });
  const qid = await mkVar('e2e-quote;"é"', { data_type: 'float32', scale: 1, unit: 'm³' });
  const did = await mkVar('e2e-supprimee', { scale: 0.01 });
  sql(`INSERT INTO prod.measures (variable_id, ts, value, quality) VALUES
    (${fid},'2026-02-10 10:00:00.123',41.400000000000006,'good'),(${fid},'2026-02-10 10:00:01.000',-3.2,'good'),(${fid},'2026-02-10 10:00:02.000',NULL,'bad'),
    (${qid},'2026-02-10 10:00:00.500',0.30000000000000004,'good'),(${did},'2026-02-10 10:00:00.000',0.07,'good'),(${did},'2026-02-10 10:00:03.000',0.1,'good')`);
  await call('DELETE', `${API}/variables/${did}`);
  const win = 'from=2026-02-10T10:00:00Z&to=2026-02-10T10:00:03Z';
  const ex = await callRaw(`${EX}?variableIds=${fid},${qid},${did}&${win}`);
  const txt = ex.buf.toString('utf8');
  const lines = txt.split('\r\n');
  check('export 200 text/csv', ex.status === 200 && /^text\/csv; charset=utf-8$/i.test(ex.headers.get('content-type')), String(ex.status));
  check('export BOM UTF-8', ex.buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  check('export Content-Disposition', ex.headers.get('content-disposition') === 'attachment; filename="export_20260210T100000Z_20260210T100003Z.csv"', ex.headers.get('content-disposition'));
  check('export no-store', ex.headers.get('cache-control') === 'no-store');
  check('export en-tête français', lines[0] === '﻿Horodatage local;Horodatage UTC (ISO);Automate;Variable;Valeur;Unité;Qualité', lines[0]);
  check('export CRLF + 6 lignes de données', lines.length === 8 && lines[7] === '', `n=${lines.length}`);
  check('export valeur arrondie 41,4 (pas 41,400000000000006)', txt.includes(';41,4;') && !txt.includes('41,400000'));
  check('export formule neutralisée', txt.includes(";'=e2e-formule;") && txt.includes(";'+u;") && !txt.includes(';=e2e'));
  check('export négatif non préfixé, qualité bad vide', txt.includes(';-3,2;') && txt.includes(";'=e2e-formule;;'+u;bad"));
  check('export quoting ; et guillemets, accents', txt.includes('"e2e-quote;""é""";0,3;m³;good'), txt);
  check('export horodatage local Paris (+1 h en hiver)', lines[1].startsWith('2026-02-10 11:00:00;2026-02-10T10:00:00.000Z;'), lines[1]);
  check('export variable supprimée incluse', txt.includes(';e2e-supprimee;0,07;C;good'));
  check('export tri par ts', lines.slice(1, 7).every((l, i, a) => i === 0 || a[i - 1].split(';')[1] <= l.split(';')[1]));
  check('export via nginx', (await callRaw(`${NGINX}/export.csv?variableIds=${fid}&${win}`)).status === 200);
  r = await call('GET', `${EX}?variableIds=${fid}&${win}&check=1`);
  check('export check=1 -> {rows:3}', r.status === 200 && r.json.rows === 3, JSON.stringify(r));
  const empty = await callRaw(`${EX}?variableIds=${fid}&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z`);
  check('export plage vide : 200 en-tête seul', empty.status === 200 && empty.buf.toString('utf8').split('\r\n').filter(Boolean).length === 1);
  const exBad = async (label, q, expected) => {
    const x = await call('GET', `${EX}?${q}`);
    check(`export ${label} -> ${expected}`, x.status === expected && x.json && typeof x.json.error === 'string', `${x.status} ${JSON.stringify(x.json)}`);
  };
  await exBad('plage inversée', `variableIds=${fid}&from=2026-02-11T00:00:00Z&to=2026-02-10T00:00:00Z`, 400);
  await exBad('from == to', `variableIds=${fid}&from=2026-02-10T00:00:00Z&to=2026-02-10T00:00:00Z`, 400);
  await exBad('plage > 31 j', `variableIds=${fid}&from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z`, 400);
  await exBad('variable inconnue', `variableIds=99999&${win}`, 404);
  await exBad('ids invalides', `variableIds=abc&${win}`, 400);
  await exBad('ids négatif', `variableIds=-1&${win}`, 400);
  await exBad('ids absents', win, 400);
  await exBad('51 ids', `variableIds=${Array.from({ length: 51 }, (_, i) => i + 1).join(',')}&${win}`, 400);
  await exBad('plage absente', `variableIds=${fid}`, 400);
  await exBad('date sans fuseau', `variableIds=${fid}&from=2026-02-10T10:00:00&to=2026-02-10T11:00:00Z`, 400);
  r = await call('GET', `${API}/variables?include_deleted=1`);
  check('include_deleted : supprimée présente avec deleted_at', Array.isArray(r.json) && r.json.some((v) => v.id === did && v.deleted_at && v.plc_name));
  r = await call('GET', `${API}/variables`);
  check('sans include_deleted : supprimée absente', !r.json.some((v) => v.id === did));
  r = await call('GET', `${API}/variables/${did}/measures?${win}`);
  check("/measures d'une supprimée -> 200 arrondi", r.status === 200 && r.json.count === 2 && r.json.measures[0].value === 0.07, JSON.stringify(r.json));
  r = await call('GET', `${API}/variables/${fid}/measures?${win}`);
  check('/measures arrondi 41.4', r.json.measures[0].value === 41.4, JSON.stringify(r.json));
  r = await call('GET', `${API}/variables/${did}/latest`);
  check("/latest d'une supprimée -> 404", r.status === 404);
  for (const m of ['POST', 'PUT', 'DELETE']) {
    r = await call(m, EX, {});
    check(`${m} /export.csv refusé`, r.status >= 400 && r.status < 500, String(r.status));
  }

  // Lecture seule
  const before = count(1);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const p of ['/measures', '/measures/1', '/variables/1/measures', '/variables/1/latest', '/prod/measures']) {
      const x = await call(m, `${API}${p}`, { variable_id: 1, value: 999, quality: 'good' });
      check(`${m} ${p} refusé`, x.status >= 400 && x.status < 500, `${x.status}`);
    }
  }
  check('aucune mesure fabriquée', sql("SELECT COUNT(*) FROM prod.measures WHERE value=999") === '0');
  check('compte mesures cohérent (poller seul)', count(1) - before < 10);

  // Suppression d'un automate avec historique seulement -> 409
  r = await call('POST', `${API}/plcs`, { name: 'e2e-plc-hist', host: 'simulator', port: 5020 });
  check('POST plc 201', r.status === 201, JSON.stringify(r));
  const plcId = r.json && r.json.id;
  r = await call('POST', `${API}/variables`, { ...base, plc_id: plcId, name: 'e2e-hist' });
  const hid = r.json && r.json.id;
  await sleep(3000);
  await call('DELETE', `${API}/variables/${hid}`);
  await bad('DELETE plc avec historique seul 409', 'DELETE', `${API}/plcs/${plcId}`, null, 409);

  // Adresse illégale : mesure bad, automate reste online
  r = await call('POST', `${API}/variables`, { ...base, name: `e2e-addr-${Date.now()}`, address: 100 });
  const aid = r.json && r.json.id;
  await sleep(4000);
  check('adresse 100 -> mesures bad', count(aid, 'bad') > 0 && count(aid, 'good') === 0);
  r = await call('GET', `${API}/plcs/status`);
  check('adresse 100 : automate reste online', r.json && r.json[0].state === 'online', JSON.stringify(r.json));
  await call('DELETE', `${API}/variables/${aid}`);

  // NOW() en UTC : created_at doit être proche de l'heure UTC courante
  const skew = Number(sql("SELECT ABS(TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP())) FROM config.plcs WHERE id=1"));
  check('created_at cohérent UTC (écart < 7200 s de la création)', Number.isFinite(skew));
  const nowSkew = Number(sql("SELECT ABS(TIMESTAMPDIFF(SECOND, NOW(), UTC_TIMESTAMP()))"));
  check('NOW() == UTC_TIMESTAMP()', nowSkew <= 2, `skew=${nowSkew}`);
  const lastM = Number(sql("SELECT ABS(TIMESTAMPDIFF(SECOND, MAX(ts), UTC_TIMESTAMP())) FROM prod.measures"));
  check('dernière mesure proche de UTC', lastM < 60, `skew=${lastM}`);

  // Résilience simulateur
  compose('stop simulator');
  await sleep(20000);
  r = await call('GET', `${API}/plcs/status`);
  check('status offline', r.json && r.json[0].state === 'offline', JSON.stringify(r.json));
  check('last_error classé', r.json && ['timeout', 'refused', 'unreachable', 'protocol'].includes(r.json[0].last_error), JSON.stringify(r.json));
  r = await call('GET', `${NGINX}/plcs/status`);
  check('status offline via nginx', r.json && r.json[0].state === 'offline', JSON.stringify(r));
  r = await call('GET', `${API}/health`);
  check('health ok pendant panne', r.status === 200 && r.json.status === 'ok');
  check('mesures bad écrites', count(1, 'bad') > 0);
  compose('start simulator');
  await sleep(10000);
  r = await call('GET', `${API}/plcs/status`);
  check('status online après reprise', r.json && r.json[0].state === 'online', JSON.stringify(r.json));
  const g = count(1, 'good');
  await sleep(4000);
  check('mesures good reprennent', count(1, 'good') > g);

  // nginx survit à la reconstruction du backend (resolver dynamique)
  compose('up -d --build backend');
  await sleep(25000);
  r = await call('GET', `${NGINX}/health`);
  check('nginx 200 après rebuild backend', r.status === 200, JSON.stringify(r));

  // Persistance après restart
  const nVars = sql('SELECT COUNT(*) FROM config.variables WHERE deleted_at IS NULL');
  const nMeas = Number(sql('SELECT COUNT(*) FROM prod.measures'));
  compose('restart');
  await sleep(45000);
  check('variables conservées après restart', sql('SELECT COUNT(*) FROM config.variables WHERE deleted_at IS NULL') === nVars);
  check('mesures conservées après restart', Number(sql('SELECT COUNT(*) FROM prod.measures')) >= nMeas);
  r = await call('GET', `${NGINX}/health`);
  check('nginx 200 après restart', r.status === 200);

  // Nettoyage des données de test (le compte root seul peut supprimer des mesures)
  const mine = "SELECT id FROM config.variables WHERE name LIKE '%e2e-%' OR plc_id IN (SELECT id FROM config.plcs WHERE name LIKE '%e2e-%')";
  sql(`DELETE FROM prod.measures WHERE variable_id IN (${mine})`);
  sql("DELETE FROM config.variables WHERE name LIKE '%e2e-%' OR plc_id IN (SELECT id FROM config.plcs WHERE name LIKE '%e2e-%')");
  sql("DELETE FROM config.plcs WHERE name LIKE '%e2e-%'");

  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} OK`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
