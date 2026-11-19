// Page Administration (admin) : comptes, équipes et appartenances. Le serveur applique les droits et les règles métier.
import { api } from './api.js';
import { mountNav, ROLE_LABELS } from './nav.js';
import { el } from './dom.js';
import { errorMessage } from './messages.js';

const $ = (id) => document.getElementById(id);
const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

const me = await mountNav({ minRole: 'admin' });
let users = [];
let teams = []; // chaque équipe porte aussi .members (détail /api/teams/:id)

// --- Messages ----------------------------------------------------------------

let flashTimer = null;
function flash(kind, message) {
  const ok = $('flash-ok');
  const ko = $('flash-error');
  ok.hidden = ko.hidden = true;
  const box = kind === 'ok' ? ok : ko;
  box.textContent = message;
  box.hidden = false;
  clearTimeout(flashTimer);
  if (kind === 'ok') flashTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

// --- Chargement --------------------------------------------------------------

async function loadAll() {
  try {
    const [u, t] = await Promise.all([api.listUsers(), api.listTeams()]);
    users = u;
    teams = await Promise.all(t.map(async (team) => ({ ...team, members: (await api.getTeam(team.id)).members ?? [] })));
    $('flash-error').hidden = true;
  } catch (err) {
    flash('error', `Chargement impossible : ${errorMessage(err)}`);
    for (const id of ['user-state', 'team-state']) { $(id).hidden = false; $(id).textContent = 'Données indisponibles.'; }
    return;
  }
  renderUsers();
  renderTeams();
}

// --- Rendu -------------------------------------------------------------------

function button(label, cls, onClick, aria) {
  const b = el('button', { className: `btn btn-sm ${cls}`, text: label, attrs: { type: 'button', 'aria-label': aria ?? label } });
  b.addEventListener('click', onClick);
  return b;
}

function renderUsers() {
  const rows = users.map((u) => {
    const isMe = u.id === me.id;
    return el('tr', {}, [
      el('td', { className: 'fw-semibold', text: isMe ? `${u.username} (vous)` : u.username }),
      el('td', { text: u.email || '—' }),
      el('td', { text: ROLE_LABELS[u.role] ?? u.role }),
      el('td', { text: u.teams.map((t) => t.name).join(', ') || '—' }),
      el('td', { text: u.created_at ? dateFmt.format(new Date(u.created_at)) : '—' }),
      el('td', { className: 'text-end text-nowrap' }, [el('span', { className: 'd-inline-flex gap-2' }, [
        button('Modifier', 'btn-outline-light', () => openUserForm(u), `Modifier ${u.username}`),
        button('Mot de passe', 'btn-outline-light', () => openPassForm(u), `Réinitialiser le mot de passe de ${u.username}`),
        // Pas de suppression de son propre compte (le serveur le refuse aussi).
        ...(isMe ? [] : [button('Supprimer', 'btn-outline-danger', () => confirmDeleteUser(u), `Supprimer ${u.username}`)]),
      ])]),
    ]);
  });
  $('user-rows').replaceChildren(...rows);
  $('user-state').hidden = users.length > 0;
  $('user-state').textContent = 'Aucun compte.';
}

function memberCell(team) {
  const cell = el('td');
  if (!team.members.length) cell.append(el('span', { className: 'text-secondary', text: 'Aucun membre' }));
  for (const m of team.members) {
    const remove = button('×', 'btn-outline-danger', () => removeMember(team, m), `Retirer ${m.username} de ${team.name}`);
    cell.append(el('span', { className: 'member-chip' }, [el('span', { text: m.username }), remove]));
  }
  return cell;
}

function addMemberCell(team) {
  const memberIds = new Set(team.members.map((m) => m.id));
  const candidates = users.filter((u) => !memberIds.has(u.id));
  if (!candidates.length) return el('td', { className: 'text-secondary', text: 'Tous les comptes sont membres' });
  const id = `add-member-${team.id}`;
  const select = el('select', { className: 'form-select form-select-sm member-select', attrs: { id, 'aria-label': `Ajouter un membre à ${team.name}` } },
    candidates.map((u) => el('option', { text: u.username, attrs: { value: String(u.id) } })));
  const add = button('Ajouter', 'btn-outline-light', () => addMember(team, Number(select.value)), `Ajouter à ${team.name}`);
  return el('td', {}, [el('div', { className: 'd-flex gap-2' }, [select, add])]);
}

function renderTeams() {
  const rows = teams.map((t) => el('tr', {}, [
    el('td', { className: 'fw-semibold', text: t.name }),
    memberCell(t),
    addMemberCell(t),
    el('td', { className: 'text-end text-nowrap' }, [el('span', { className: 'd-inline-flex gap-2' }, [
      button('Renommer', 'btn-outline-light', () => openTeamForm(t), `Renommer ${t.name}`),
      button('Supprimer', 'btn-outline-danger', () => confirmDeleteTeam(t), `Supprimer ${t.name}`),
    ])]),
  ]));
  $('team-rows').replaceChildren(...rows);
  $('team-state').hidden = teams.length > 0;
  $('team-state').textContent = 'Aucune équipe. Créez-en une pour y affecter des comptes.';
}

// --- Utilitaires de formulaire -----------------------------------------------

function setFormError(id, message) {
  const box = $(id);
  box.hidden = !message;
  box.textContent = message ?? '';
}

function showFieldErrors(form, errors) {
  for (const input of form.elements) {
    if (!input.name) continue;
    const msg = errors[input.name];
    input.classList.toggle('is-invalid', Boolean(msg));
    const feedback = input.parentElement.querySelector('.invalid-feedback');
    if (feedback) feedback.textContent = msg ?? '';
  }
  form.querySelector('.is-invalid')?.focus();
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  // Un mot de passe ne doit pas survivre à la fermeture du dialogue.
  dialog.addEventListener('close', () => dialog.querySelector('form')?.reset());
}

// Valide, envoie, ferme et recharge ; en cas d'erreur serveur le dialogue reste ouvert.
async function submitForm({ form, errorId, errors, save, dialog, doneMessage }) {
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) { setFormError(errorId, null); return; }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await save();
    dialog.close();
    flash('ok', doneMessage);
    await loadAll();
  } catch (err) {
    setFormError(errorId, errorMessage(err));
  } finally {
    submit.disabled = false;
  }
}

function checkPassword(value, errors, key) {
  if (value.length < 10 || value.length > 128) errors[key] = 'Entre 10 et 128 caractères.';
}

// --- Comptes -----------------------------------------------------------------

let editingUser = null;

function openUserForm(user = null) {
  editingUser = user;
  const form = $('user-form');
  form.reset();
  $('user-dialog-title').textContent = user ? `Modifier le compte « ${user.username} »` : 'Créer un compte';
  // L'identifiant et le mot de passe initial ne se règlent qu'à la création.
  $('user-name-group').hidden = Boolean(user);
  $('user-pass-group').hidden = Boolean(user);
  if (user) {
    form.elements.email.value = user.email ?? '';
    form.elements.role.value = user.role;
  } else {
    form.elements.role.value = 'viewer';
  }
  showFieldErrors(form, {});
  setFormError('user-error', null);
  $('user-dialog').showModal();
}

$('user-add').addEventListener('click', () => openUserForm());
$('user-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const f = Object.fromEntries(new FormData(form));
  const email = f.email.trim();
  const errors = {};
  if (email && !EMAIL_RE.test(email)) errors.email = 'Adresse e-mail invalide.';
  if (!editingUser) {
    if (!USERNAME_RE.test(f.username.trim())) errors.username = '3 à 50 caractères : lettres, chiffres, point, tiret, souligné.';
    checkPassword(f.password, errors, 'password');
  }
  const editing = editingUser;
  // Changer son propre rôle peut retirer ses droits d'administration : confirmation explicite.
  if (editing && editing.id === me.id && f.role !== editing.role && !Object.keys(errors).length
    && !window.confirm(`Vous modifiez votre propre rôle (${ROLE_LABELS[editing.role]} vers ${ROLE_LABELS[f.role]}). Vous pourriez perdre l'accès à cette page. Continuer ?`)) {
    return;
  }
  submitForm({
    form, errorId: 'user-error', errors, dialog: $('user-dialog'),
    save: () => (editing
      ? api.updateUser(editing.id, { email: email || null, role: f.role })
      : api.createUser({ username: f.username.trim(), ...(email ? { email } : {}), password: f.password, role: f.role })),
    doneMessage: editing ? 'Compte modifié.' : 'Compte créé.',
  });
});

let passUser = null;

function openPassForm(user) {
  passUser = user;
  const form = $('pass-form');
  form.reset();
  $('pass-dialog-title').textContent = `Réinitialiser le mot de passe de « ${user.username} »`;
  showFieldErrors(form, {});
  setFormError('pass-error', null);
  $('pass-dialog').showModal();
}

$('pass-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const errors = {};
  const value = e.target.elements.new_password.value;
  checkPassword(value, errors, 'new_password');
  const target = passUser;
  submitForm({
    form: e.target, errorId: 'pass-error', errors, dialog: $('pass-dialog'),
    save: () => api.resetPassword(target.id, value),
    doneMessage: `Mot de passe de « ${target.username} » réinitialisé.`,
  });
});

// --- Équipes -----------------------------------------------------------------

let editingTeam = null;

function openTeamForm(team = null) {
  editingTeam = team;
  const form = $('team-form');
  form.reset();
  $('team-dialog-title').textContent = team ? `Renommer l'équipe « ${team.name} »` : 'Créer une équipe';
  if (team) form.elements.name.value = team.name;
  showFieldErrors(form, {});
  setFormError('team-error', null);
  $('team-dialog').showModal();
}

$('team-add').addEventListener('click', () => openTeamForm());
$('team-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = e.target.elements.name.value.trim();
  const errors = {};
  if (name.length < 1 || name.length > 100) errors.name = 'Entre 1 et 100 caractères.';
  const editing = editingTeam;
  submitForm({
    form: e.target, errorId: 'team-error', errors, dialog: $('team-dialog'),
    save: () => (editing ? api.renameTeam(editing.id, name) : api.createTeam(name)),
    doneMessage: editing ? 'Équipe renommée.' : 'Équipe créée.',
  });
});

async function addMember(team, userId) {
  try {
    await api.addMember(team.id, userId);
    flash('ok', 'Membre ajouté.');
  } catch (err) {
    flash('error', errorMessage(err));
  }
  await loadAll();
}

async function removeMember(team, member) {
  try {
    await api.removeMember(team.id, member.id);
    flash('ok', `${member.username} retiré de « ${team.name} ».`);
  } catch (err) {
    flash('error', errorMessage(err));
  }
  await loadAll();
}

// --- Suppression avec confirmation -------------------------------------------

function confirmDelete(text, action, doneMessage) {
  const dialog = $('confirm-dialog');
  $('confirm-text').textContent = text;
  dialog.returnValue = '';
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'confirm') return;
    try {
      await action();
      flash('ok', doneMessage);
    } catch (err) {
      flash('error', errorMessage(err));
    }
    await loadAll();
  }, { once: true });
  dialog.showModal();
}

function confirmDeleteUser(user) {
  confirmDelete(`Supprimer le compte « ${user.username} » ? Ses sessions seront fermées. Cette action est irréversible.`,
    () => api.deleteUser(user.id), 'Compte supprimé.');
}

function confirmDeleteTeam(team) {
  confirmDelete(`Supprimer l'équipe « ${team.name} » ? Les comptes ne sont pas supprimés, ils quittent seulement l'équipe.`,
    () => api.deleteTeam(team.id), 'Équipe supprimée.');
}

loadAll();
