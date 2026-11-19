// Tableau de bord temps réel : une carte + un mini-graphique par variable active.
// Un seul minuteur de données (latest + status) ; la liste des variables est relue
// périodiquement pour détecter ajouts, suppressions et modifications.
import { api, serverNow } from './api.js';
import { mountNav } from './nav.js';
import { STATES } from './dom.js';
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
let generation = 0; // invalide les boucles de liste d'une session précédente (visibilitychange)

// --- Graphique ---------------------------------------------------------------

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function createChart(canvas, variable) {
  const gridColor = cssVar('--border');
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
        x: { type: 'linear', grid: { color: gridColor }, ticks: { color: muted, maxTicksLimit: 5, callback: (v) => formatClock(v) } },
        y: { grid: { color: gridColor }, ticks: { color: muted, maxTicksLimit: 4 } },
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

function buildCard(variable, plcName) {
  const node = document.importNode($('card-template').content, true).firstElementChild;
  node.querySelector('.var-name').textContent = variable.name;
  node.querySelector('.var-plc').textContent =
    `${plcName} · ${variable.register_type} ${variable.address} · toutes les ${variable.frequency_s} s`;
  node.querySelector('.var-unit').textContent = variable.unit;
  const canvas = node.querySelector('canvas');
  canvas.setAttribute('aria-label', `Évolution de ${variable.name} sur les 10 dernières minutes`);
  return {
    variable, signature: signatureOf(variable, plcName), node,
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

async function syncList() {
  const [variables, plcs] = await Promise.all([api.listVariables(), api.listPlcs()]);
  const plcNames = new Map(plcs.map((p) => [p.id, p.name]));
  const active = variables.filter((v) => v.enabled);
  const activeIds = new Set(active.map((v) => v.id));
  const loads = [];
  let changed = false;

  for (const id of [...cards.keys()]) {
    if (!activeIds.has(id)) { removeCard(id); changed = true; }
  }
  for (const v of active) {
    const plcName = plcNames.get(v.plc_id) ?? `Automate ${v.plc_id}`;
    const existing = cards.get(v.id);
    if (existing && existing.signature === signatureOf(v, plcName)) continue;
    if (existing) removeCard(v.id); // variable modifiée : on reconstruit la carte
    const card = buildCard(v, plcName);
    cards.set(v.id, card);
    loads.push(loadHistory(card));
    changed = true;
  }
  if (changed) {
    // Ordre d'affichage stable : par id de variable
    const sorted = [...cards.values()].sort((a, b) => a.variable.id - b.variable.id);
    grid.replaceChildren(...sorted.map((c) => c.node));
    restartPollTimer();
  }
  showView(cards.size ? 'cards' : 'empty');
  await Promise.all(loads);
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
    setError('tick-error', `Données indisponibles : ${err.message} Nouvelle tentative automatique…`);
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
    setError('list-error', `Liste des variables indisponible : ${err.message} Nouvelle tentative automatique…`);
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

await mountNav();
start();
