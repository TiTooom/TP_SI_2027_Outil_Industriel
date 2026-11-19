// Page Export : sélection plage + variables, aperçu Chart.js, téléchargement CSV.
// Le CSV n'est jamais chargé en mémoire : fetch(check=1) valide, puis navigation native.
import { api, exportUrl } from './api.js';
import { mountNav } from './nav.js';
import { el } from './dom.js';

const DAY_MS = 24 * 3600 * 1000;
const MAX_EXPORT_DAYS = 31;
const MAX_PREVIEW_DAYS = 7;
const MAX_VARIABLES = 50;
const PREVIEW_LIMIT = 5000;
const PREVIEW_CONCURRENCY = 4;
const CHECK_TIMEOUT_MS = 60000; // le COUNT sur une grande plage peut être long
const PALETTE = ['#4aa3ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39c5cf', '#ff7b72', '#e3b341', '#56d364', '#a5a5ff'];

const $ = (id) => document.getElementById(id);
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });

let variables = [];
let chart = null;
let previewRun = 0; // invalide un aperçu devenu obsolète (nouvelle demande)

// --- Messages ----------------------------------------------------------------

function flash(kind, message) {
  const ok = $('flash-ok');
  const ko = $('flash-error');
  ok.hidden = ko.hidden = true;
  if (!message) return;
  const box = kind === 'ok' ? ok : ko;
  box.textContent = message;
  box.hidden = false;
}

function setBusy(busy, text = '') {
  $('download-btn').disabled = busy;
  $('preview-btn').disabled = busy;
  $('action-state').textContent = text;
}

// --- Plage de dates ----------------------------------------------------------

// Valeur pour <input type="datetime-local"> en heure locale (secondes incluses).
function toLocalInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 19);
}

function setShortcut(hours) {
  const now = Date.now();
  $('range-to').value = toLocalInput(now);
  $('range-from').value = toLocalInput(now - hours * 3600 * 1000);
}

function readRange() {
  // Chaîne sans fuseau : interprétée en heure locale du navigateur.
  return { from: Date.parse($('range-from').value), to: Date.parse($('range-to').value) };
}

// --- Variables ---------------------------------------------------------------

function selectedIds() {
  return [...document.querySelectorAll('#var-list input[type="checkbox"]:checked')].map((c) => Number(c.value));
}

function updateHint() {
  const n = selectedIds().length;
  $('var-hint').textContent = `${n} sélectionnée${n > 1 ? 's' : ''} (max ${MAX_VARIABLES})`;
}

function renderVariables() {
  const list = $('var-list');
  list.replaceChildren();
  // Regroupement par automate, actives avant supprimées dans chaque groupe.
  const groups = new Map();
  for (const v of variables) {
    if (!groups.has(v.plc_id)) groups.set(v.plc_id, { name: v.plc_name ?? `Automate n°${v.plc_id}`, items: [] });
    groups.get(v.plc_id).items.push(v);
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => Boolean(a.deleted_at) - Boolean(b.deleted_at) || a.name.localeCompare(b.name, 'fr'));
    const box = el('div', { className: 'plc-group' }, [el('div', { className: 'plc-group-title', text: group.name })]);
    for (const v of group.items) {
      const id = `var-${v.id}`;
      const label = el('label', { className: 'form-check-label', attrs: { for: id } }, [
        document.createTextNode(v.unit ? `${v.name} (${v.unit})` : v.name),
      ]);
      if (v.deleted_at) label.append(' ', el('span', { className: 'tag-deleted', text: '(supprimée)' }));
      box.append(el('div', { className: 'form-check' }, [
        el('input', { className: 'form-check-input', attrs: { type: 'checkbox', id, value: String(v.id) } }),
        label,
      ]));
    }
    list.append(box);
  }
  $('var-state').hidden = variables.length > 0;
  if (!variables.length) $('var-state').textContent = 'Aucune variable. Créez-en dans la page Configuration.';
  updateHint();
}

async function loadVariables() {
  try {
    variables = await api.listVariablesWithDeleted();
    renderVariables();
  } catch (err) {
    $('var-state').hidden = false;
    $('var-state').textContent = `Impossible de charger les variables : ${err.message}`;
  }
}

function setAllChecked(checked) {
  document.querySelectorAll('#var-list input[type="checkbox"]').forEach((c) => { c.checked = checked; });
  updateHint();
}

// --- Validation --------------------------------------------------------------

// Retourne les paramètres validés, ou null après affichage de l'erreur.
function validate() {
  const ids = selectedIds();
  const { from, to } = readRange();
  let error = null;
  if (Number.isNaN(from) || Number.isNaN(to)) error = 'Renseignez le début et la fin de la plage.';
  else if (from >= to) error = 'Le début doit être antérieur à la fin.';
  else if (to - from > MAX_EXPORT_DAYS * DAY_MS) error = `La plage ne peut pas dépasser ${MAX_EXPORT_DAYS} jours.`;
  else if (ids.length === 0) error = 'Sélectionnez au moins une variable.';
  else if (ids.length > MAX_VARIABLES) error = `Sélectionnez au plus ${MAX_VARIABLES} variables (${ids.length} choisies).`;
  if (error) {
    flash('error', error);
    return null;
  }
  flash();
  return { ids, from: new Date(from).toISOString(), to: new Date(to).toISOString(), fromMs: from, toMs: to };
}

// --- Téléchargement ----------------------------------------------------------

async function checkExport(params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(exportUrl({ variableIds: params.ids, from: params.from, to: params.to, check: true }),
      { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `Erreur serveur (HTTP ${res.status})`);
    return data.rows;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Délai dépassé : le serveur ne répond pas.');
    if (err instanceof TypeError) throw new Error('Serveur injoignable.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function onDownload(event) {
  event.preventDefault();
  const params = validate();
  if (!params) return;
  setBusy(true, 'Vérification…');
  try {
    const rows = await checkExport(params);
    flash('ok', rows === 0
      ? "Aucune mesure sur cette plage : le fichier ne contiendra que l'en-tête."
      : `${rows.toLocaleString('fr-FR')} ligne${rows > 1 ? 's' : ''} à exporter, téléchargement lancé.`);
    // Navigation native : le navigateur gère le flux (Content-Disposition: attachment).
    window.location.assign(exportUrl({ variableIds: params.ids, from: params.from, to: params.to }));
  } catch (err) {
    flash('error', err.message);
  } finally {
    setBusy(false);
  }
}

// --- Aperçu ------------------------------------------------------------------

function showPreviewState(text) {
  $('preview-state').textContent = text;
  $('preview-state').hidden = false;
  $('preview-wrap').hidden = true;
  if (chart) { chart.destroy(); chart = null; }
}

// Exécute `worker` sur `items` avec au plus `n` requêtes simultanées.
async function pool(items, n, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

function buildDataset(variable, measures, color) {
  // Mesures « bad » -> null : trou dans la courbe.
  const data = measures.map((m) => ({ x: Date.parse(m.ts), y: m.quality === 'good' ? m.value : null }));
  return {
    label: variable.unit ? `${variable.name} (${variable.unit})` : variable.name,
    data, parsing: false, spanGaps: false, borderColor: color, backgroundColor: color,
    borderWidth: 2, pointRadius: 0, tension: 0, stepped: variable.data_type === 'bool' ? 'before' : false,
  };
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawChart(datasets, xMin, xMax) {
  const grid = cssVar('--border');
  const muted = cssVar('--muted');
  if (chart) chart.destroy();
  chart = new Chart($('preview-chart'), {
    type: 'line',
    data: { datasets },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { labels: { color: cssVar('--text') } },
        tooltip: { callbacks: { title: (items) => dateTimeFmt.format(items[0].parsed.x) } },
      },
      scales: {
        x: { type: 'linear', min: xMin, max: xMax, grid: { color: grid },
          ticks: { color: muted, maxTicksLimit: 8, callback: (v) => dateTimeFmt.format(v) } },
        y: { grid: { color: grid }, ticks: { color: muted } },
      },
    },
  });
}

async function onPreview() {
  const params = validate();
  if (!params) return;
  const run = ++previewRun;
  let { fromMs } = params;
  const { toMs } = params;
  const note = $('preview-note');
  note.hidden = true;
  const notes = [];
  // L'API /measures plafonne la plage à 7 jours : on garde les plus récents.
  if (toMs - fromMs > MAX_PREVIEW_DAYS * DAY_MS) {
    fromMs = toMs - MAX_PREVIEW_DAYS * DAY_MS;
    notes.push('Aperçu limité aux 7 jours les plus récents de la plage (le CSV couvrira toute la plage).');
  }
  setBusy(true, "Chargement de l'aperçu…");
  showPreviewState('Chargement…');
  const byId = new Map(variables.map((v) => [v.id, v]));
  const results = new Map();
  const failures = [];
  let truncated = false;
  try {
    await pool(params.ids, PREVIEW_CONCURRENCY, async (id) => {
      try {
        const res = await api.measures(id, { from: new Date(fromMs).toISOString(), to: params.to, limit: PREVIEW_LIMIT });
        if (res.measures.length >= PREVIEW_LIMIT) truncated = true;
        results.set(id, res.measures);
      } catch (err) {
        failures.push(`${byId.get(id)?.name ?? id} : ${err.message}`);
      }
    });
    if (run !== previewRun) return;
    if (truncated) notes.push(`Au plus ${PREVIEW_LIMIT} points récents par variable sont affichés.`);
    if (failures.length) notes.push(`Variables non chargées : ${failures.join(' ; ')}`);
    const datasets = [];
    params.ids.forEach((id, i) => {
      const m = results.get(id);
      if (m?.length) datasets.push(buildDataset(byId.get(id), m, PALETTE[i % PALETTE.length]));
    });
    if (datasets.length === 0) {
      showPreviewState(failures.length ? 'Aperçu indisponible.' : 'Aucune mesure sur cette plage pour les variables choisies.');
    } else {
      $('preview-state').hidden = true;
      $('preview-wrap').hidden = false;
      drawChart(datasets, fromMs, toMs);
    }
    note.textContent = notes.join(' ');
    note.hidden = notes.length === 0;
  } finally {
    if (run === previewRun) setBusy(false);
  }
}

// --- Démarrage ---------------------------------------------------------------

await mountNav();
setShortcut(24);
document.querySelectorAll('[data-hours]').forEach((b) => b.addEventListener('click', () => setShortcut(Number(b.dataset.hours))));
$('select-all').addEventListener('click', () => setAllChecked(true));
$('select-none').addEventListener('click', () => setAllChecked(false));
$('var-list').addEventListener('change', updateHint);
$('export-form').addEventListener('submit', onDownload);
$('preview-btn').addEventListener('click', onPreview);
loadVariables();
