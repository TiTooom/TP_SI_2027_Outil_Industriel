// Tableau de bord temps réel : une carte + un mini-graphique par variable active.
// Un seul minuteur de données (latest + status) ; la liste des variables est relue
// périodiquement pour détecter ajouts, suppressions et modifications.
import { api, serverNow } from './api.js';
import { errorMessage } from './messages.js';
import { mountNav, hasRole } from './nav.js';
import { initLayout } from './layout.js';
import { buildWriteForm } from './writeForm.js';
import { STATES, el } from './dom.js';
import { formatValue, formatClock } from './format.js';
import { chartColors, onThemeChange } from './theme.js';
import { HEIGHT, SIZE_WIDTH, WIDTH, heightOf, widthOf } from './widget.js';

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
let canWrite = false; // technician+ : le serveur applique la vraie règle
let generation = 0; // invalide les boucles de liste d'une session précédente (visibilitychange)

// --- Graphique ---------------------------------------------------------------

function createChart(canvas, variable) {
  const { grid: gridColor, muted, accent } = chartColors();
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        data: [], parsing: false, spanGaps: false, borderColor: accent, borderWidth: 2,
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

// Couleurs dépendantes du thème et couleur de courbe choisie (card.color, sinon l'accent du thème).
function styleChart(card) {
  const { grid, muted, accent } = chartColors();
  const { x, y } = card.chart.options.scales;
  x.grid.color = y.grid.color = grid;
  x.ticks.color = y.ticks.color = muted;
  card.chart.data.datasets[0].borderColor = card.color ?? accent;
  card.chart.update('none');
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
  return JSON.stringify([v.name, v.unit, v.frequency_s, v.plc_id, v.data_type, v.register_type, v.address, v.writable, plcName]);
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
  const handle = el('span', { className: 'drag-handle', text: '⠿ glisser', attrs: { title: 'Glisser pour déplacer la carte' } });
  const width = slider(`Largeur de ${name}`, 'Largeur', 'card-width', { min: WIDTH.min, max: WIDTH.max, step: 1 }, (n) => `${n}/12`);
  const height = slider(`Hauteur du graphique de ${name}`, 'Hauteur', 'card-height', { min: HEIGHT.min, max: HEIGHT.max, step: HEIGHT.step }, (n) => `${n} px`);
  const color = el('input', { className: 'form-control form-control-color card-color', attrs: { type: 'color', 'aria-label': `Couleur de la courbe de ${name}`, 'data-testid': 'card-color' } });
  const resetColor = btn('card-color-reset', 'Couleur par défaut', `Rétablir la couleur de la courbe de ${name}`);
  const colorGroup = el('label', { className: 'tool-field' }, [el('span', { text: 'Courbe' }), color]);
  const root = el('div', { className: 'card-tools', attrs: { role: 'group', 'aria-label': `Édition de ${name}` } },
    [handle, up, down, size, remove, width.root, height.root, colorGroup, resetColor]);

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
  width.input.addEventListener('input', () => display.actions?.style(id, { w: Number(width.input.value) }));
  height.input.addEventListener('input', () => display.actions?.style(id, { h: Number(height.input.value) }));
  color.addEventListener('input', () => display.actions?.style(id, { color: color.value }));
  resetColor.addEventListener('click', () => display.actions?.style(id, { color: null }));
  return { root, handle, up, down, size, width, height, color, resetColor };
}

// Curseur étiqueté avec sa valeur lisible (« 6/12 », « 180 px »).
function slider(ariaLabel, label, testId, { min, max, step }, format) {
  const input = el('input', {
    className: 'form-range', attrs: { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': ariaLabel, 'data-testid': testId },
  });
  const value = el('output', { className: 'tool-value' });
  const set = (n) => { input.value = String(n); value.textContent = format(Number(input.value)); };
  input.addEventListener('input', () => { value.textContent = format(Number(input.value)); });
  return { root: el('label', { className: 'tool-field' }, [el('span', { text: label }), input, value]), input, set };
}

// Glisser-déposer HTML5 natif : la carte glissée prend la place de la carte survolée.
// La carte n'est « glissable » que pendant un appui sur sa poignée : sinon tirer un curseur ou
// le sélecteur de couleur entraînerait toute la carte avec lui.
function attachDrag(node, id, handle) {
  const arm = () => { node.draggable = display.editing; };
  const disarm = () => { node.draggable = false; };
  handle.addEventListener('pointerdown', arm);
  handle.addEventListener('pointerup', disarm);
  handle.addEventListener('pointercancel', disarm);
  node.addEventListener('dragstart', (e) => {
    if (!display.editing || e.target !== node) return;
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id)); // requis par Firefox
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    disarm();
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
  // Variable modifiable : champ d'envoi sous le graphique, pour qui a le droit d'écrire (masqué en mode édition, cf. CSS).
  const write = variable.writable && canWrite ? buildWriteForm(variable, () => tick()) : null;
  if (write) node.querySelector('.var-foot').before(write.root);
  node.append(tools.root);
  attachDrag(node, variable.id, tools.handle);
  return {
    variable, signature: signatureOf(variable, plcName), node, tools, write,
    valueEl: node.querySelector('.var-value'), badgeEl: node.querySelector('.state-badge'),
    footEl: node.querySelector('.var-foot'), lastTs: 0, lastMeasure: null, historyLoaded: false,
    color: null, chart: createChart(canvas, variable),
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
  card.write?.setCurrent(good ? card.lastMeasure.value : null);
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

// Applique taille, hauteur et couleur d'un widget (null = vue « Toutes les variables », réglages par défaut).
// setProperty plutôt qu'un attribut style : la CSP interdit le style inline.
function applyWidget(card, widget) {
  const { node, tools } = card;
  node.className = widget ? `var-card size-${widget.size}` : 'var-card';
  const set = (name, value) => (value === null ? node.style.removeProperty(name) : node.style.setProperty(name, value));
  set('--w', widget ? String(widthOf(widget)) : null);
  // Sous 1200 px une carte étroite deviendrait illisible : on impose 6 colonnes au minimum.
  set('--w-tablet', widget ? String(Math.max(6, widthOf(widget))) : null);
  set('--chart-h', widget?.h ? `${widget.h}px` : null);
  tools.size.value = widget?.size ?? 'md';
  tools.width.set(widget ? widthOf(widget) : SIZE_WIDTH.md);
  tools.height.set(widget ? heightOf(widget) : HEIGHT.fallback);
  const color = widget?.color ?? null;
  tools.color.value = color ?? chartColors().accent;
  tools.resetColor.disabled = color === null;
  if (card.color !== color) { card.color = color; styleChart(card); }
}

// Fait correspondre les cartes au tableau choisi : crée les manquantes, détruit les retirées
// ou modifiées (chart.destroy), réordonne et applique tailles / état d'édition sans toucher aux autres.
function reconcile() {
  if (!catalogReady || !display.ready) return [];
  const wanted = display.widgets === null
    ? [...active.values()].sort((a, b) => a.variable.id - b.variable.id).map((e) => ({ ...e, widget: null }))
    : display.widgets.filter((w) => active.has(w.variableId)).map((w) => ({ ...active.get(w.variableId), widget: w }));
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
    applyWidget(card, wanted[i].widget);
    if (!display.editing) card.node.draggable = false;
    card.tools.up.disabled = i === 0;
    card.tools.down.disabled = i === ordered.length - 1;
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

// Changement de thème : les graphiques relisent leurs couleurs (axes, grille, courbe par défaut).
onThemeChange(() => {
  for (const card of cards.values()) styleChart(card);
});

const user = await mountNav();
canWrite = hasRole(user, 'technician');
layout = initLayout({ user, display });
start();
