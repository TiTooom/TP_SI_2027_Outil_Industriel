// Barre de navigation commune : session (/api/auth/me), liens selon le rôle, « Mon compte », déconnexion, pastille /api/health.
// Les pages protégées sont masquées (body.auth-pending) tant que la session n'est pas confirmée ; le serveur reste la vraie barrière.
import { api } from './api.js';
import { el } from './dom.js';
import { errorMessage } from './messages.js';

const HEALTH_REFRESH_MS = 10000;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

export const ROLE_RANK = { viewer: 1, technician: 2, engineer: 3, admin: 4 };
export const ROLE_LABELS = { viewer: 'lecteur', technician: 'technicien', engineer: 'ingénieur', admin: 'administrateur' };
export const hasRole = (user, min) => ROLE_RANK[user.role] >= ROLE_RANK[min];

const LINKS = [
  { href: 'index.html', label: 'Tableau de bord', min: 'viewer' },
  { href: 'config.html', label: 'Configuration', min: 'viewer' },
  { href: 'export.html', label: 'Export', min: 'viewer' },
  { href: 'admin.html', label: 'Administration', min: 'admin' },
];

// --- Mon compte (changement de mot de passe) ---------------------------------

function field(id, label, autocomplete) {
  const input = el('input', { className: 'form-control', attrs: { id, type: 'password', autocomplete, required: '', maxlength: String(MAX_PASSWORD) } });
  return { input, group: el('div', { className: 'mb-3' }, [el('label', { className: 'form-label', text: label, attrs: { for: id } }), input]) };
}

function buildAccountDialog(user) {
  const current = field('acc-current', 'Mot de passe actuel', 'current-password');
  const next = field('acc-new', `Nouveau mot de passe (${MIN_PASSWORD} à ${MAX_PASSWORD} caractères)`, 'new-password');
  const confirm = field('acc-confirm', 'Confirmer le nouveau mot de passe', 'new-password');
  const error = el('div', { className: 'alert alert-danger', attrs: { role: 'alert', hidden: '' } });
  const ok = el('div', { className: 'alert alert-success', attrs: { role: 'status', hidden: '' } });
  const submit = el('button', { className: 'btn btn-primary', text: 'Changer le mot de passe', attrs: { type: 'submit' } });
  const close = el('button', { className: 'btn btn-outline-secondary', text: 'Fermer', attrs: { type: 'button' } });
  const form = el('form', { attrs: { novalidate: '' } }, [
    el('h2', { className: 'h5', text: 'Mon compte', attrs: { id: 'acc-title' } }),
    el('p', { className: 'text-secondary', text: `${user.username} — ${ROLE_LABELS[user.role] ?? user.role}` }),
    error, ok, current.group, next.group, confirm.group,
    el('div', { className: 'dialog-actions' }, [close, submit]),
  ]);
  const dialog = el('dialog', { attrs: { 'aria-labelledby': 'acc-title' } }, [form]);

  const show = (box, msg) => { error.hidden = ok.hidden = true; box.textContent = msg; box.hidden = false; };
  close.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current.input.value) return show(error, 'Saisissez votre mot de passe actuel.');
    if (next.input.value.length < MIN_PASSWORD || next.input.value.length > MAX_PASSWORD) {
      return show(error, `Le nouveau mot de passe doit faire entre ${MIN_PASSWORD} et ${MAX_PASSWORD} caractères.`);
    }
    if (next.input.value !== confirm.input.value) return show(error, 'La confirmation ne correspond pas.');
    submit.disabled = true;
    try {
      await api.changePassword(current.input.value, next.input.value);
      form.reset();
      show(ok, 'Mot de passe modifié. Vos autres sessions ont été fermées.');
    } catch (err) {
      show(error, errorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });
  dialog.addEventListener('close', () => { form.reset(); error.hidden = ok.hidden = true; });
  return dialog;
}

// --- Barre -------------------------------------------------------------------

function buildNav(user) {
  const current = LINKS.find(({ href }) => location.pathname.endsWith(href))?.href ?? 'index.html';
  const links = LINKS.filter(({ min }) => hasRole(user, min)).map(({ href, label }) => {
    const a = el('a', { className: 'nav-link', text: label, attrs: { href } });
    if (href === current) a.setAttribute('aria-current', 'page');
    return el('li', { className: 'nav-item' }, [a]);
  });
  const dot = el('span', { className: 'dot', attrs: { 'aria-hidden': 'true' } });
  const text = el('span', { text: 'Système…' });
  const health = el('span', { className: 'health-pill', attrs: { role: 'status', title: 'État de /api/health' } }, [dot, text]);

  const account = el('button', { className: 'btn btn-outline-light btn-sm', text: 'Mon compte', attrs: { type: 'button' } });
  const logout = el('button', { className: 'btn btn-outline-secondary btn-sm', text: 'Déconnexion', attrs: { type: 'button' } });
  const dialog = buildAccountDialog(user);
  account.addEventListener('click', () => dialog.showModal());
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try { await api.logout(); } catch { /* session déjà invalide : on quitte quand même */ }
    location.replace('login.html');
  });

  const who = el('span', { className: 'user-pill', text: `${user.username} (${ROLE_LABELS[user.role] ?? user.role})` });
  const nav = el('nav', { className: 'navbar app-nav px-3', attrs: { 'aria-label': 'Navigation principale' } }, [
    el('span', { className: 'navbar-brand fw-semibold', text: 'Supervision Process' }),
    el('ul', { className: 'navbar-nav flex-row gap-3 me-auto' }, links),
    health, who, account, logout,
  ]);
  document.body.append(dialog);
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

// Vérifie la session, monte la nav et dévoile la page. Renvoie l'utilisateur ; si la session est absente
// ou le rôle insuffisant, la page reste masquée (la promesse ne se résout jamais) pendant la redirection.
export async function mountNav({ minRole = 'viewer' } = {}) {
  let user;
  try {
    user = await api.me();
  } catch (err) {
    // 401 : redirection déjà lancée par api.js ; autre erreur : message sobre, page toujours masquée.
    if (err.status !== 401) {
      // L'id app-nav est conservé : c'est lui qui échappe à la règle CSS body.auth-pending.
      const retry = el('button', { className: 'btn btn-outline-light btn-sm ms-3', text: 'Réessayer', attrs: { type: 'button' } });
      retry.addEventListener('click', () => location.reload());
      const msg = el('div', { className: 'panel-msg', attrs: { id: 'app-nav', role: 'alert' } }, [
        el('span', { text: `Vérification de la session impossible : ${errorMessage(err)}` }),
        retry,
      ]);
      document.getElementById('app-nav').replaceWith(msg);
    }
    return new Promise(() => {});
  }
  if (!hasRole(user, minRole)) {
    location.replace('index.html');
    return new Promise(() => {});
  }
  const parts = buildNav(user);
  document.getElementById('app-nav').replaceWith(parts.nav);
  document.body.classList.remove('auth-pending');
  refreshHealth(parts);
  setInterval(() => { if (!document.hidden) refreshHealth(parts); }, HEALTH_REFRESH_MS);
  return user;
}
