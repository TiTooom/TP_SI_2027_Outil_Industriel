// Barre de navigation commune + pastille d'état système (/api/health).
import { api } from './api.js';
import { el } from './dom.js';

const HEALTH_REFRESH_MS = 10000;
const LINKS = [
  { href: 'index.html', label: 'Tableau de bord' },
  { href: 'config.html', label: 'Configuration' },
  { href: 'export.html', label: 'Export' },
];

function buildNav() {
  const current = LINKS.find(({ href }) => location.pathname.endsWith(href))?.href ?? 'index.html';
  const links = LINKS.map(({ href, label }) => {
    const a = el('a', { className: 'nav-link', text: label, attrs: { href } });
    if (href === current) a.setAttribute('aria-current', 'page');
    return el('li', { className: 'nav-item' }, [a]);
  });
  const dot = el('span', { className: 'dot', attrs: { 'aria-hidden': 'true' } });
  const text = el('span', { text: 'Système…' });
  const health = el('span', { className: 'health-pill', attrs: { role: 'status', title: 'État de /api/health' } }, [dot, text]);
  const nav = el('nav', { className: 'navbar app-nav px-3', attrs: { 'aria-label': 'Navigation principale' } }, [
    el('span', { className: 'navbar-brand fw-semibold', text: 'Supervision Process' }),
    el('ul', { className: 'navbar-nav flex-row gap-3 me-auto' }, links),
    health,
  ]);
  return { nav, dot, text, health };
}

async function refreshHealth({ dot, text, health }) {
  try {
    const body = await api.health();
    dot.className = 'dot ok';
    text.textContent = 'Système OK';
    health.title = `Base API : ${body.db?.api ?? '?'} — Base relevés : ${body.db?.poller ?? '?'} — actif depuis ${body.uptime_s ?? '?'} s`;
  } catch (err) {
    // 503 = backend vivant mais base dégradée ; status 0 = backend injoignable
    dot.className = `dot ${err.status === 503 ? 'warn' : 'ko'}`;
    text.textContent = err.status === 503 ? 'Système dégradé' : 'Backend hors ligne';
    health.title = err.message;
  }
}

export function mountNav() {
  const parts = buildNav();
  document.getElementById('app-nav').replaceWith(parts.nav);
  refreshHealth(parts);
  setInterval(() => { if (!document.hidden) refreshHealth(parts); }, HEALTH_REFRESH_MS);
}
