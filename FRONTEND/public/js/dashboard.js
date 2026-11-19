// Tableau de bord temps réel : une carte + un mini-graphique par variable active.
// Un seul minuteur de données (latest + status) ; la liste des variables est relue
// périodiquement pour détecter ajouts, suppressions et modifications.
import { api, serverNow } from './api.js';
import { errorMessage } from './messages.js';
import { mountNav } from './nav.js';
import { initLayout } from './layout.js';
import { STATES, el } from './dom.js';
import { formatValue, formatClock } from './format.js';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_POINTS = 300;
const LIST_REFRESH_MS = 15000;
const RETRY_MS = 5000;
const MIN_POLL_S = 1;
const MAX_POLL_S = 30;

const $ = (id) => document.getElementById(id);
const grid = $('cards');
const cards = new Map(); // variable_id -> état de la carte (DOM, graphique, dernière mesure)
let plcStatus = new Map();
let pollTimer = null;
let listTimer = null;
let ticking = false;
// Ce qu'il faut afficher, piloté par layout.js : widgets = null -> « Toutes les variables » ;
// sinon liste ordonnée { variableId, size }. ready = false tant que le tableau n'est pas choisi.
const display = { ready: false, widgets: null, editing: false, actions: null };
let active = new Map(); // variable_id -> { variable, plcName } (variables actives connues du serveur)
let catalogReady = false;
let layout = null;
let dragId = null;
let generation = 0; // invalide les boucles de liste d'une session précédente (visibilitychange)

// --- Graphique ---------------------------------------------------------------

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function createChart(canvas, variable) {
  const gridColor = 'rgba(255,255,255,.08)';
  const muted = cssVar('--muted');
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        data: [], parsing: false, spanGaps: false, borderColor: cssVar('--accent'), borderWidth: 2,
        pointRadius: 0, tension: 0, stepped: variable.data_type === 'bool' ? 'before' : false,
      }],
    },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (items) => new Date(items[0].parsed.x).toLocaleTimeString('fr-FR') } },
      },
      scales: {
        x: { type: 'linear', grid: { color: gridColor }, ticks: { color: muted, font: { size: 12 }, maxTicksLimit: 5, callback: (v) => formatClock(v) } },
        y: { grid: { color: gridColor }, ticks: { color: muted, font: { size: 12 }, maxTicksLimit: 4 } },
      },
    },
  });
}

// Fenêtre glissante : retire les points trop vieux ou en surnombre, recale l'axe X.
function slideWindow(card, now = serverNow()) {
  const data = card.chart.data.datasets[0].data;
  while (data.length && data[0].x < now - WINDOW_MS) data.shift();
  while (data.length > MAX_POINTS) data.shift();
  card.chart.options.scales.x.min = now - WINDOW_MS;
  card.chart.options.scales.x.max = now;
  card.chart.update('none');
}

// Les mesures « bad » deviennent null : trou dans la courbe (spanGaps: false).
function pushMeasure(card, m) {
  const x = Date.parse(m.ts);
  if (!(x > card.lastTs)) return; // ts déjà vu : pas de nouveau point
  card.lastTs = x;
  card.lastMeasure = m;
  card.chart.data.datasets[0].data.push({ x, y: m.quality === 'good' ? m.value : null });
}

// --- Cartes ------------------------------------------------------------------

function signatureOf(v, plcName) {
  return JSON.stringify([v.name, v.unit, v.frequency_s, v.plc_id, v.data_type, v.register_type, v.address, plcName]);
}

// Barre d'édition de la carte (visible seulement en mode édition, cf. CSS .editing).
function buildTools(variable) {
  const name = variable.name;
  const btn = (cls, text, label) => el('button', {
    className: `btn btn-outline-light btn-sm ${cls}`, text,
    attrs: { type: 'button', 'aria-label': label, 'data-testid': cls },
  });
  const up = btn('card-move-up', '▲', `Monter ${name}`);
  const down = btn('card-move-down', '▼', `Descendre ${name}`);
  const remove = btn('card-remove', 'Retirer', `Retirer ${name} du tableau`);
  const size = el('select', {
    className: 'form-select form-select-sm card-size',
    attrs: { 'aria-label': `Taille de ${name}`, 'data-testid': 'card-size' },
  }, [['sm', 'Petit'], ['md', 'Moyen'], ['lg', 'Grand']].map(([v, t]) => el('option', { text: t, attrs: { value: v } })));
  const handle = el('span', { className: 'drag-hint', text: '⠿ glisser', attrs: { 'aria-hidden': 'true' } });
  const root = el('div', { className: 'card-tools', attrs: { role: 'group', 'aria-label': `Édition de ${name}` } }, [handle, up, down, size, remove]);

  const id = variable.id;
  // Après un déplacement le DOM est réordonné : on rend le focus au bouton (ou à son opposé s'il est désactivé).
  const moveWith = (button, other, dir) => button.addEventListener('click', () => {
    display.actions?.move(id, dir);
    (button.disabled ? other : button).focus();
  });
  moveWith(up, down, -1);
  moveWith(down, up, 1);
  size.addEventListener('change', () => display.actions?.resize(id, size.value));
  remove.addEventListener('click', () => display.actions?.remove(id));
  return { root, up, down, size };
}

// Glisser-déposer HTML5 natif : la carte glissée prend la place de la carte survolée.
function attachDrag(node, id) {
  node.addEventListener('dragstart', (e) => {
    if (!display.editing || e.target !== node) return;
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id)); // requis par Firefox
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    dragId = null;
    node.classList.remove('dragging');
    for (const n of grid.querySelectorAll('.drop-target')) n.classList.remove('drop-target');
  });
  node.addEventListener('dragover', (e) => {
    if (!display.editing || dragId === null || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget)) node.classList.remove('drop-target');
  });
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    node.classList.remove('drop-target');
    if (display.editing && dragId !== null && dragId !== id) display.actions?.reorder(dragId, id);
    dragId = null;
  });
}

function buildCard(variable, plcName) {
  const node = document.importNode($('card-template').content, true).firstElementChild;
  node.querySelector('.var-name').textContent = variable.name;
  node.querySelector('.var-plc').textContent =
    `${plcName} · ${variable.register_type} ${variable.address} · toutes les ${variable.frequency_s} s`;
  node.querySelector('.var-unit').textContent = variable.unit;
  const canvas = node.querySelector('canvas');
  canvas.setAttribute('aria-label', `Évolution de ${variable.name} sur les 10 dernières minutes`);
  const tools = buildTools(variable);
  node.append(tools.root);
  attachDrag(node, variable.id);
  return {
    variable, signature: signatureOf(variable, plcName), node, tools,
    valueEl: node.querySelector('.var-value'), badgeEl: node.querySelector('.state-badge'),
    footEl: node.querySelector('.var-foot'), lastTs: 0, lastMeasure: null, historyLoaded: false,
    chart: createChart(canvas, variable),
  };
}

async function loadHistory(card) {
  try {
    // Sans `from` : le serveur applique sa fenêtre par défaut (10 min), indépendante de l'horloge client.
    const res = await api.measures(card.variable.id, { limit: MAX_POINTS });
    for (const m of res.measures) pushMeasure(card, m);
  } catch {
    // Historique indisponible : le graphique se remplira via les mesures suivantes.
  }
  card.historyLoaded = true;
  if (cards.get(card.variable.id) === card) { // la carte a pu être retirée entre-temps
    slideWindow(card);
    renderCard(card);
  }
}

function stateOf(card) {
  const st = plcStatus.get(card.variable.plc_id);
  if (st?.state === 'offline') return 'offline';
  if (!card.lastMeasure) return 'pending';
  if (card.lastMeasure.quality === 'bad') return 'invalid';
  return 'ok';
}

function renderCard(card) {
  const key = stateOf(card);
  const s = STATES[key];
  card.badgeEl.className = `state-badge ${s.cls}`;
  card.badgeEl.querySelector('.dot').className = `dot ${s.cls}`;
  card.badgeEl.querySelector('.state-text').textContent = s.label;
  const good = card.lastMeasure?.quality === 'good';
  card.valueEl.textContent = good ? formatValue(card.lastMeasure.value) : '—';
  card.valueEl.classList.toggle('stale', !good || key === 'offline');
  const st = plcStatus.get(card.variable.plc_id);
  if (key === 'offline' && st?.last_error) card.footEl.textContent = `Erreur : ${st.last_error}`;
  else if (card.lastMeasure) card.footEl.textContent = `Dernière mesure à ${new Date(card.lastMeasure.ts).toLocaleTimeString('fr-FR')}`;
  else card.footEl.textContent = 'Aucune mesure pour le moment';
}

function removeCard(id) {
  const card = cards.get(id);
  card.chart.destroy(); // libère le canvas et l'écouteur de redimensionnement
  card.node.remove();
  cards.delete(id);
}

// --- Synchronisation de la liste ---------------------------------------------

function showView(view) {
  $('loading-state').hidden = view !== 'loading';
  $('empty-state').hidden = view !== 'empty';
  $('empty-dashboard').hidden = view !== 'empty-dashboard';
  grid.hidden = view !== 'cards';
}

function setError(id, message) {
  const banner = $(id);
  banner.hidden = !message;
  banner.textContent = message ?? '';
}

function pollIntervalMs() {
  const freqs = [...cards.values()].map((c) => c.variable.frequency_s);
  const s = freqs.length ? Math.min(...freqs) : MAX_POLL_S;
  return Math.min(MAX_POLL_S, Math.max(MIN_POLL_S, s)) * 1000;
}

function restartPollTimer() {
  clearInterval(pollTimer);
  pollTimer = setInterval(tick, pollIntervalMs());
}

// Fait correspondre les cartes au tableau choisi : crée les manquantes, détruit les retirées
// ou modifiées (chart.destroy), réordonne et applique tailles / état d'édition sans toucher aux autres.
function reconcile() {
  if (!catalogReady || !display.ready) return [];
  const wanted = display.widgets === null
    ? [...active.values()].sort((a, b) => a.variable.id - b.variable.id).map((e) => ({ ...e, size: null }))
    : display.widgets.filter((w) => active.has(w.variableId)).map((w) => ({ ...active.get(w.variableId), size: w.size }));
  const wantedIds = new Set(wanted.map((e) => e.variable.id));
  const loads = [];
  let changed = false;

  for (const [id, card] of [...cards]) {
    const e = active.get(id);
    if (!wantedIds.has(id) || card.signature !== signatureOf(e.variable, e.plcName)) { removeCard(id); changed = true; }
  }
  for (const e of wanted) {
    if (cards.has(e.variable.id)) continue;
    const card = buildCard(e.variable, e.plcName);
    cards.set(e.variable.id, card);
    loads.push(loadHistory(card));
    changed = true;
  }
  const ordered = wanted.map((e) => cards.get(e.variable.id));
  if (ordered.length !== grid.children.length || ordered.some((c, i) => grid.children[i] !== c.node)) {
    grid.replaceChildren(...ordered.map((c) => c.node));
  }
  grid.classList.toggle('layout-grid', display.widgets !== null);
  grid.classList.toggle('editing', display.editing);
  ordered.forEach((card, i) => {
    const size = display.widgets === null ? null : wanted[i].size;
    card.node.className = size ? `var-card size-${size}` : 'var-card';
    card.node.draggable = display.editing;
    card.tools.up.disabled = i === 0;
    card.tools.down.disabled = i === ordered.length - 1;
    card.tools.size.value = size ?? 'md';
  });
  if (changed) restartPollTimer();
  if (cards.size || display.editing) showView('cards');
  else showView(display.widgets === null ? 'empty' : 'empty-dashboard');
  return loads;
}

async function syncList() {
  const [variables, plcs] = await Promise.all([api.listVariables(), api.listPlcs()]);
  const plcNames = new Map(plcs.map((p) => [p.id, p.name]));
  active = new Map(variables.filter((v) => v.enabled).map((v) => [
    v.id, { variable: v, plcName: plcNames.get(v.plc_id) ?? `Automate ${v.plc_id}` },
  ]));
  catalogReady = true;
  layout?.setVariables([...active.values()].map((e) => ({ id: e.variable.id, name: e.variable.name, plcName: e.plcName })));
  await Promise.all(reconcile());
}

// --- Boucles -----------------------------------------------------------------

async function tick() {
  if (ticking || !cards.size) return;
  ticking = true;
  try {
    const [latest, statuses] = await Promise.all([api.latestAll(), api.plcStatus()]);
    plcStatus = new Map(statuses.map((s) => [s.plc_id, s]));
    const byVar = new Map(latest.map((m) => [m.variable_id, m]));
    const now = serverNow();
    for (const [id, card] of cards) {
      if (!card.historyLoaded) continue; // l'historique n'est pas encore là : évite de le perdre
      const m = byVar.get(id);
      if (m) pushMeasure(card, m);
      slideWindow(card, now);
      renderCard(card);
    }
    setError('tick-error', null);
    $('last-update').textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR')}`;
  } catch (err) {
    setError('tick-error', `Données indisponibles : ${errorMessage(err)} Nouvelle tentative automatique…`);
  } finally {
    ticking = false;
  }
}

// Relit la liste puis se replanifie : rythme rapide tant qu'aucune carte n'est affichée (erreur initiale).
async function listLoop(gen) {
  try {
    await syncList();
    setError('list-error', null);
  } catch (err) {
    if (!cards.size) $('loading-state').textContent = 'Connexion au serveur…';
    setError('list-error', `Liste des variables indisponible : ${errorMessage(err)} Nouvelle tentative automatique…`);
  }
  if (gen === generation && !document.hidden) listTimer = setTimeout(() => listLoop(gen), cards.size ? LIST_REFRESH_MS : RETRY_MS);
}

async function start() {
  const gen = ++generation;
  restartPollTimer();
  await listLoop(gen);
  tick();
}

function stop() {
  generation++;
  clearInterval(pollTimer);
  clearTimeout(listTimer);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else start();
});
window.addEventListener('pagehide', () => {
  stop();
  for (const id of [...cards.keys()]) removeCard(id);
});

display.show = (widgets, editing, actions) => {
  display.ready = true;
  display.widgets = widgets;
  display.editing = editing;
  display.actions = actions;
  reconcile();
};

const user = await mountNav();
layout = initLayout({ user, display });
start();
