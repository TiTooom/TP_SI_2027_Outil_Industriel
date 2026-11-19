// Page Configuration : CRUD des automates et des variables, état de connexion des automates.
import { api } from './api.js';
import { mountNav, hasRole } from './nav.js';
import { badge, el } from './dom.js';
import { formatValue } from './format.js';
import { validatePlc, validateVariable } from './validate.js';
import { errorMessage } from './messages.js';

const STATUS_REFRESH_MS = 5000;
const $ = (id) => document.getElementById(id);

let plcs = [];
let variables = [];
let statuses = new Map();
// Droits d'affichage (le serveur applique la vraie règle) : engineer+ modifie, technician pilote les variables.
let canEdit = false;
let canOperate = false;

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

// --- Rendu des tableaux ------------------------------------------------------

function plcStateKey(plc) {
  if (!plc.enabled) return 'disabled';
  const st = statuses.get(plc.id)?.state;
  if (st === 'online') return 'ok';
  if (st === 'offline') return 'offline';
  return 'pending';
}

function actionButtons(onEdit, onDelete, label) {
  if (!canEdit) return el('td');
  const edit = el('button', { className: 'btn btn-outline-light btn-sm', text: 'Modifier', attrs: { type: 'button', 'aria-label': `Modifier ${label}` } });
  const del = el('button', { className: 'btn btn-outline-danger btn-sm', text: 'Supprimer', attrs: { type: 'button', 'aria-label': `Supprimer ${label}` } });
  edit.addEventListener('click', onEdit);
  del.addEventListener('click', onDelete);
  return el('td', { className: 'text-end text-nowrap' }, [el('span', { className: 'd-inline-flex gap-2' }, [edit, del])]);
}

function yesNo(flag) {
  return el('span', { className: flag ? 'text-success' : 'text-secondary', text: flag ? 'Oui' : 'Non' });
}

// Technicien : activation et fréquence modifiables sur place via PATCH.
async function patchVariable(variable, fields, okMessage) {
  try {
    await api.patchVariable(variable.id, fields);
    flash('ok', okMessage);
  } catch (err) {
    flash('error', errorMessage(err));
  }
  await loadAll();
}

function enabledSwitch(v) {
  const input = el('input', { className: 'form-check-input', attrs: { type: 'checkbox', role: 'switch', 'aria-label': `Activer ${v.name}` } });
  input.checked = v.enabled;
  input.addEventListener('change', () => {
    input.disabled = true;
    patchVariable(v, { enabled: input.checked }, input.checked ? 'Variable activée.' : 'Variable désactivée.');
  });
  return el('div', { className: 'form-check form-switch mb-0' }, [input]);
}

function frequencyEditor(v) {
  const input = el('input', { className: 'form-control form-control-sm freq-input', attrs: { type: 'number', min: '1', max: '86400', 'aria-label': `Fréquence de ${v.name} en secondes` } });
  input.value = v.frequency_s;
  const save = el('button', { className: 'btn btn-outline-light btn-sm', text: 'OK', attrs: { type: 'button', 'aria-label': `Enregistrer la fréquence de ${v.name}` } });
  save.addEventListener('click', () => {
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 1 || n > 86400) {
      input.classList.add('is-invalid');
      flash('error', 'Fréquence : entier entre 1 et 86400 secondes.');
      return;
    }
    save.disabled = true;
    patchVariable(v, { frequency_s: n }, 'Fréquence modifiée.');
  });
  return el('div', { className: 'd-flex gap-2 align-items-center' }, [input, el('span', { text: 's' }), save]);
}

function renderPlcs() {
  const rows = plcs.map((p) => {
    const st = statuses.get(p.id);
    const conn = el('td', {}, [badge(plcStateKey(p))]);
    if (st?.state === 'offline' && st.last_error) conn.append(el('div', { className: 'small text-secondary', text: st.last_error }));
    return el('tr', {}, [
      el('td', { className: 'fw-semibold', text: p.name }),
      el('td', { text: `${p.host} : ${p.port}` }),
      el('td', { text: String(p.unit_id) }),
      el('td', {}, [yesNo(p.enabled)]),
      el('td', { text: String(p.variable_count ?? 0) }),
      conn,
      actionButtons(() => openPlcForm(p), () => confirmDeletePlc(p), p.name),
    ]);
  });
  $('plc-rows').replaceChildren(...rows);
  const state = $('plc-state');
  state.hidden = plcs.length > 0;
  state.textContent = 'Aucun automate. Ajoutez-en un pour commencer.';
}

function renderVariables() {
  const names = new Map(plcs.map((p) => [p.id, p.name]));
  const rows = variables.map((v) => el('tr', {}, [
    el('td', { className: 'fw-semibold', text: v.name }),
    el('td', { text: names.get(v.plc_id) ?? `#${v.plc_id}` }),
    el('td', { text: `${v.register_type} ${v.address}` }),
    el('td', { text: v.data_type }),
    el('td', { text: `× ${String(v.scale)} / ${formatValue(v.value_offset)}` }),
    el('td', { text: v.unit || '—' }),
    el('td', canOperate && !canEdit ? {} : { text: `${v.frequency_s} s` }, canOperate && !canEdit ? [frequencyEditor(v)] : []),
    el('td', {}, [canOperate && !canEdit ? enabledSwitch(v) : yesNo(v.enabled)]),
    actionButtons(() => openVarForm(v), () => confirmDeleteVar(v), v.name),
  ]));
  $('var-rows').replaceChildren(...rows);
  const state = $('var-state');
  state.hidden = variables.length > 0;
  state.textContent = plcs.length ? 'Aucune variable. Ajoutez-en une pour la voir sur le tableau de bord.' : "Créez d'abord un automate.";
  $('var-add').disabled = plcs.length === 0;
  $('var-add').hidden = !canEdit;
}

// --- Chargement --------------------------------------------------------------

async function loadAll() {
  try {
    const [p, v, s] = await Promise.all([api.listPlcs(), api.listVariables(), api.plcStatus()]);
    plcs = p;
    variables = v;
    statuses = new Map(s.map((x) => [x.plc_id, x]));
    $('flash-error').hidden = true;
  } catch (err) {
    flash('error', `Chargement impossible : ${err.message}`);
    for (const id of ['plc-state', 'var-state']) $(id).textContent = 'Données indisponibles.';
    return;
  }
  renderPlcs();
  renderVariables();
}

// Rafraîchissement périodique de l'état de connexion (et des compteurs de variables)
async function refreshStatus() {
  if (document.hidden || document.querySelector('dialog[open]')) return;
  try {
    const [p, s] = await Promise.all([api.listPlcs(), api.plcStatus()]);
    plcs = p;
    statuses = new Map(s.map((x) => [x.plc_id, x]));
    renderPlcs();
  } catch {
    // Erreur transitoire : on garde l'affichage précédent, le prochain cycle réessaiera.
  }
}

// --- Formulaires (utilitaires) -----------------------------------------------

function readForm(form) {
  const out = {};
  for (const input of form.elements) {
    if (!input.name) continue;
    out[input.name] = input.type === 'checkbox' ? input.checked : input.value;
  }
  return out;
}

function showFieldErrors(form, errors) {
  for (const input of form.elements) {
    if (!input.name) continue;
    const msg = errors[input.name];
    input.classList.toggle('is-invalid', Boolean(msg));
    const feedback = input.parentElement.querySelector('.invalid-feedback');
    if (feedback) feedback.textContent = msg ?? '';
  }
  const first = form.querySelector('.is-invalid');
  if (first) first.focus();
}

function setFormError(id, message) {
  const box = $(id);
  box.hidden = !message;
  box.textContent = message ?? '';
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
}

// Enregistre via l'API ; garde le dialogue ouvert et affiche l'erreur serveur en cas d'échec.
async function submitForm({ form, errorId, validator, save, dialog, doneMessage }) {
  const { errors, value } = validator(readForm(form));
  showFieldErrors(form, errors);
  if (!value) { setFormError(errorId, null); return; }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await save(value);
    dialog.close();
    flash('ok', doneMessage);
    await loadAll();
  } catch (err) {
    setFormError(errorId, errorMessage(err));
  } finally {
    button.disabled = false;
  }
}

// --- Automates ---------------------------------------------------------------

let editingPlc = null;

function openPlcForm(plc = null) {
  editingPlc = plc;
  const form = $('plc-form');
  form.reset();
  $('plc-dialog-title').textContent = plc ? `Modifier l'automate « ${plc.name} »` : 'Ajouter un automate';
  if (plc) {
    form.elements.name.value = plc.name;
    form.elements.host.value = plc.host;
    form.elements.port.value = plc.port;
    form.elements.unit_id.value = plc.unit_id;
    form.elements.enabled.checked = plc.enabled;
  }
  showFieldErrors(form, {});
  setFormError('plc-error', null);
  $('plc-dialog').showModal();
}

$('plc-add').addEventListener('click', () => openPlcForm());
$('plc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = editingPlc?.id;
  submitForm({
    form: e.target, errorId: 'plc-error', validator: validatePlc, dialog: $('plc-dialog'),
    save: (v) => (id ? api.updatePlc(id, v) : api.createPlc(v)),
    doneMessage: id ? 'Automate modifié.' : 'Automate créé.',
  });
});

// --- Variables ---------------------------------------------------------------

let editingVar = null;

// coil/discrete => bool uniquement ; holding/input => bool interdit
function syncDataTypes() {
  const form = $('var-form');
  const bitRegister = ['coil', 'discrete'].includes(form.elements.register_type.value);
  const select = form.elements.data_type;
  for (const opt of select.options) opt.disabled = bitRegister ? opt.value !== 'bool' : opt.value === 'bool';
  if (select.selectedOptions[0]?.disabled) select.value = bitRegister ? 'bool' : 'int16';
}

$('var-register').addEventListener('change', syncDataTypes);

function openVarForm(variable = null) {
  editingVar = variable;
  const form = $('var-form');
  form.reset();
  $('var-dialog-title').textContent = variable ? `Modifier la variable « ${variable.name} »` : 'Ajouter une variable';
  form.elements.plc_id.replaceChildren(...plcs.map((p) => el('option', { text: p.name, attrs: { value: String(p.id) } })));
  if (variable) {
    for (const key of ['name', 'plc_id', 'register_type', 'address', 'data_type', 'scale', 'value_offset', 'unit', 'frequency_s']) {
      form.elements[key].value = variable[key];
    }
    form.elements.enabled.checked = variable.enabled;
  }
  syncDataTypes();
  showFieldErrors(form, {});
  setFormError('var-error', null);
  $('var-dialog').showModal();
}

$('var-add').addEventListener('click', () => openVarForm());
$('var-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = editingVar?.id;
  submitForm({
    form: e.target, errorId: 'var-error', validator: validateVariable, dialog: $('var-dialog'),
    save: (v) => (id ? api.updateVariable(id, v) : api.createVariable(v)),
    doneMessage: id ? 'Variable modifiée.' : 'Variable créée.',
  });
});

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
      await loadAll();
    } catch (err) {
      // 409 : automate avec variables, etc. Le message serveur est affiché tel quel.
      flash('error', err.status === 409 ? `Suppression impossible : ${err.message}` : errorMessage(err));
    }
  }, { once: true });
  dialog.showModal();
}

function confirmDeletePlc(plc) {
  confirmDelete(
    `Supprimer l'automate « ${plc.name} » ? Un automate qui possède des variables (même supprimées, car leur historique est conservé) ne peut pas être supprimé.`,
    () => api.deletePlc(plc.id), 'Automate supprimé.',
  );
}

function confirmDeleteVar(variable) {
  confirmDelete(
    `Supprimer la variable « ${variable.name} » ? Le relevé s'arrête ; l'historique des mesures est conservé.`,
    () => api.deleteVariable(variable.id), 'Variable supprimée.',
  );
}

// --- Démarrage ---------------------------------------------------------------

const user = await mountNav();
canEdit = hasRole(user, 'engineer');
canOperate = hasRole(user, 'technician');
$('plc-add').hidden = !canEdit;
$('role-note').hidden = canEdit;
$('role-note').textContent = canOperate
  ? 'Mode exploitation : vous pouvez activer/désactiver une variable et modifier sa fréquence.'
  : 'Mode lecture seule.';
loadAll();
setInterval(refreshStatus, STATUS_REFRESH_MS);
