// Tableaux de bord configurables : sélecteur, création / renommage / suppression, mode édition.
// Ce module gère l'état et l'API ; l'affichage des cartes reste dans dashboard.js (display.show).
import { api } from './api.js';
import { el } from './dom.js';
import { errorMessage } from './messages.js';
import { hasRole } from './nav.js';

const MAX_WIDGETS = 50;
const MAX_NAME = 100;
const SIZES = ['sm', 'md', 'lg'];
const ALL = 'all'; // vue par défaut « Toutes les variables » : jamais enregistrée, lecture seule

const $ = (id) => document.getElementById(id);

export function initLayout({ user, display }) {
  const storageKey = `dashboard:${user.id}`;
  let list = [];            // tableaux visibles (sans layout)
  let current = null;       // tableau complet affiché, null = vue par défaut
  let selected = ALL;       // valeur du <select>
  let editing = false;
  let draft = [];           // widgets en cours d'édition
  let saved = '';           // JSON du layout enregistré, pour détecter les modifications
  let catalog = [];         // variables actives : { id, name, plcName }
  let catalogReady = false; // vrai après une lecture réussie des variables
  let busy = false;
  let loadToken = 0;        // ignore les réponses d'un chargement dépassé

  // --- Messages, mémoire locale ---------------------------------------------

  function notify(kind, text) {
    $('dashboard-error').hidden = kind !== 'error' || !text;
    $('dashboard-info').hidden = kind !== 'info' || !text;
    if (text) $(kind === 'error' ? 'dashboard-error' : 'dashboard-info').textContent = text;
  }

  function remember(value) {
    try { localStorage.setItem(storageKey, value); } catch { /* stockage indisponible : sans conséquence */ }
  }
  function recall() {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  }

  // --- Dialogues --------------------------------------------------------------

  function confirmDialog(message, label = 'Confirmer') {
    const dialog = $('confirm-dialog');
    $('confirm-text').textContent = message;
    $('confirm-ok').textContent = label;
    return new Promise((resolve) => {
      let result = false;
      const ok = () => { result = true; dialog.close(); };
      const cancel = () => dialog.close();
      const done = () => {
        $('confirm-ok').removeEventListener('click', ok);
        $('confirm-cancel').removeEventListener('click', cancel);
        dialog.removeEventListener('close', done);
        resolve(result);
      };
      $('confirm-ok').addEventListener('click', ok);
      $('confirm-cancel').addEventListener('click', cancel);
      dialog.addEventListener('close', done);
      dialog.showModal();
    });
  }

  // Équipes où l'utilisateur peut créer un tableau : engineer+ (ses équipes) ou toutes pour l'admin.
  async function creatableTeams() {
    if (user.role === 'admin') {
      try { return await api.listTeams(); } catch { return user.teams ?? []; }
    }
    return hasRole(user, 'engineer') ? (user.teams ?? []) : [];
  }

  // Ouvre le dialogue de nom ; onSubmit(name, teamId) lève une erreur affichée dans le dialogue.
  async function nameDialog({ title, submitLabel, value, withScope, onSubmit }) {
    const dialog = $('name-dialog');
    const error = $('name-error');
    const input = $('name-input');
    $('name-title').textContent = title;
    $('name-submit').textContent = submitLabel;
    input.value = value;
    error.hidden = true;
    $('scope-group').hidden = !withScope;
    if (withScope) {
      const teams = await creatableTeams();
      $('scope-select').replaceChildren(
        el('option', { text: 'Personnel (visible par moi seul)', attrs: { value: '' } }),
        ...teams.map((t) => el('option', { text: `Équipe ${t.name}`, attrs: { value: String(t.id) } })),
      );
    }
    const form = $('name-form');
    return new Promise((resolve) => {
      const submit = async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name || name.length > MAX_NAME) {
          error.textContent = `Le nom doit faire entre 1 et ${MAX_NAME} caractères.`;
          error.hidden = false;
          return;
        }
        $('name-submit').disabled = true;
        try {
          await onSubmit(name, withScope && $('scope-select').value ? Number($('scope-select').value) : null);
          dialog.close();
        } catch (err) {
          error.textContent = errorMessage(err);
          error.hidden = false;
        } finally {
          $('name-submit').disabled = false;
        }
      };
      const cancel = () => dialog.close();
      const done = () => {
        form.removeEventListener('submit', submit);
        $('name-cancel').removeEventListener('click', cancel);
        dialog.removeEventListener('close', done);
        resolve();
      };
      form.addEventListener('submit', submit);
      $('name-cancel').addEventListener('click', cancel);
      dialog.addEventListener('close', done);
      dialog.showModal();
      input.focus();
    });
  }

  // --- Sélecteur ------------------------------------------------------------

  function option(d, label) {
    return el('option', { text: label, attrs: { value: String(d.id) } });
  }

  function renderSelect() {
    const select = $('dashboard-select');
    const mine = list.filter((d) => d.scope === 'user' && d.owner_user_id === user.id);
    const others = list.filter((d) => d.scope === 'user' && d.owner_user_id !== user.id);
    const teams = new Map();
    for (const d of list.filter((x) => x.scope === 'team')) {
      if (!teams.has(d.owner_team_name)) teams.set(d.owner_team_name, []);
      teams.get(d.owner_team_name).push(d);
    }
    const group = (label, items, fmt = (d) => d.name) => (items.length
      ? [el('optgroup', { attrs: { label } }, items.map((d) => option(d, fmt(d))))] : []);
    select.replaceChildren(
      el('option', { text: 'Toutes les variables', attrs: { value: ALL } }),
      ...group('Mes tableaux', mine),
      ...[...teams].flatMap(([name, items]) => group(`Équipe ${name}`, items)),
      ...(user.role === 'admin' ? group('Autres tableaux', others, (d) => `${d.name} (${d.owner_username ?? '?'})`) : []),
    );
    select.value = selected;
    select.disabled = false;
  }

  // --- Brouillon et affichage -----------------------------------------------

  const layoutJson = (widgets) => JSON.stringify(widgets.map((w) => [w.variableId, w.size]));
  const isDirty = () => editing && layoutJson(draft) !== saved;

  function savedWidgets() {
    const widgets = current?.layout?.widgets ?? [];
    return widgets.map((w) => ({ variableId: w.variableId, size: SIZES.includes(w.size) ? w.size : 'md' }));
  }

  // Une seule fonction rafraîchit tout : cartes, barre d'édition, boutons.
  function refresh() {
    const canEdit = current?.can_edit === true;
    $('btn-new').disabled = editing || busy || !catalogReady; // la création enchaîne sur l'édition
    $('btn-rename').hidden = !canEdit || editing;
    $('btn-delete').hidden = !canEdit || editing;
    $('btn-edit').hidden = !canEdit || editing;
    $('btn-edit').disabled = !catalogReady || busy;
    $('readonly-badge').hidden = canEdit;
    $('edit-bar').hidden = !editing;
    display.show(current ? (editing ? draft : savedWidgets()) : null, editing, actions);
    if (editing) renderEditBar();
    window.onbeforeunload = isDirty() ? (e) => { e.preventDefault(); e.returnValue = ''; } : null;
  }

  function renderEditBar() {
    const shown = new Set(draft.map((w) => w.variableId));
    const addable = catalog.filter((v) => !shown.has(v.id));
    const full = draft.length >= MAX_WIDGETS;
    const select = $('add-variable-select');
    select.replaceChildren(...(addable.length
      ? addable.map((v) => el('option', { text: `${v.name} (${v.plcName})`, attrs: { value: String(v.id) } }))
      : [el('option', { text: 'Aucune variable à ajouter', attrs: { value: '' } })]));
    select.disabled = full || !addable.length;
    $('btn-add-variable').disabled = full || !addable.length;
    $('edit-count').textContent = `${draft.length} / ${MAX_WIDGETS} variables${full ? ' (maximum atteint)' : ''}`;
    $('edit-dirty').hidden = !isDirty();
    $('btn-save').disabled = busy || !isDirty();
  }

  // --- Actions d'édition (appelées par les cartes) ------------------------------

  const indexOf = (id) => draft.findIndex((w) => w.variableId === id);
  const actions = {
    move(id, dir) {
      const i = indexOf(id);
      const active = new Set(catalog.map((v) => v.id));
      let j = i + dir;
      while (j >= 0 && j < draft.length && !active.has(draft[j].variableId)) j += dir; // saute les widgets non affichés
      if (i < 0 || j < 0 || j >= draft.length) return;
      [draft[i], draft[j]] = [draft[j], draft[i]];
      refresh();
    },
    reorder(fromId, toId) {
      const from = indexOf(fromId);
      const to = indexOf(toId);
      if (from < 0 || to < 0) return;
      draft.splice(to, 0, draft.splice(from, 1)[0]);
      refresh();
    },
    resize(id, size) {
      const w = draft[indexOf(id)];
      if (w && SIZES.includes(size)) { w.size = size; refresh(); }
    },
    remove(id) {
      draft = draft.filter((w) => w.variableId !== id);
      refresh();
    },
  };

  function startEdit() {
    if (!catalogReady) return; // sans catalogue, on ne sait pas quoi afficher : pas d'édition
    // Le brouillon garde tous les widgets enregistrés, y compris variables inactives ou inconnues
    // (non affichées, mais conservées à l'enregistrement).
    draft = savedWidgets();
    editing = true;
    saved = layoutJson(draft);
    refresh();
    $('btn-save').scrollIntoView?.({ block: 'nearest' });
  }

  function cancelEdit() {
    editing = false;
    draft = [];
    notify('info', '');
    refresh();
  }

  async function save() {
    busy = true;
    renderEditBar();
    try {
      current = await api.updateDashboard(current.id, { layout: { version: 1, widgets: draft.map((w) => ({ variableId: w.variableId, size: w.size })) } });
      patchList(current);
      editing = false;
      draft = [];
      notify('info', 'Tableau enregistré.');
    } catch (err) {
      notify('error', `Enregistrement impossible : ${errorMessage(err)}`);
    } finally {
      busy = false;
      refresh();
    }
  }

  // --- Chargement / sélection ---------------------------------------------------

  function patchList(d) {
    const { layout, ...summary } = d;
    summary.widget_count = layout?.widgets?.length ?? summary.widget_count;
    list = list.map((x) => (x.id === d.id ? summary : x));
    renderSelect();
  }

  async function select(value) {
    const token = ++loadToken;
    if (value !== ALL) {
      try {
        const full = await api.getDashboard(value);
        if (token !== loadToken) return;
        current = full;
      } catch (err) {
        if (token !== loadToken) return;
        notify('error', errorMessage(err));
        if (err.status === 404) await reloadList(); // le tableau a disparu : on resynchronise
        return select(ALL); // repli sûr
      }
    } else {
      current = null;
    }
    selected = value;
    editing = false;
    draft = [];
    remember(value);
    $('dashboard-select').value = value;
    refresh();
  }

  async function reloadList() {
    try { list = await api.listDashboards(); } catch { /* on garde la liste connue */ }
    renderSelect();
  }

  // Changement manuel : confirmation si des modifications seraient perdues.
  async function onSelectChange() {
    const value = $('dashboard-select').value;
    if (isDirty() && !(await confirmDialog('Des modifications ne sont pas enregistrées. Les abandonner ?', 'Abandonner'))) {
      $('dashboard-select').value = selected;
      return;
    }
    notify('info', '');
    notify('error', '');
    await select(value);
  }

  async function create() {
    await nameDialog({
      title: 'Nouveau tableau', submitLabel: 'Créer', value: '', withScope: true,
      onSubmit: async (name, teamId) => {
        const body = teamId ? { name, team_id: teamId } : { name };
        const created = await api.createDashboard(body);
        const { layout, ...summary } = created;
        list.push(summary);
        list.sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name, 'fr') : a.scope === 'user' ? -1 : 1));
        selected = String(created.id);
        current = created;
        editing = false;
        remember(selected);
        renderSelect();
        notify('info', `Tableau « ${created.name} » créé.`);
        refresh();
        startEdit(); // on enchaîne sur l'ajout des variables
      },
    });
  }

  async function rename() {
    await nameDialog({
      title: 'Renommer le tableau', submitLabel: 'Renommer', value: current.name, withScope: false,
      onSubmit: async (name) => {
        current = await api.updateDashboard(current.id, { name });
        patchList(current);
        notify('info', 'Tableau renommé.');
      },
    });
  }

  async function remove() {
    if (!(await confirmDialog(`Supprimer définitivement le tableau « ${current.name} » ?`, 'Supprimer'))) return;
    try {
      await api.deleteDashboard(current.id);
      list = list.filter((d) => d.id !== current.id);
      notify('info', `Tableau « ${current.name} » supprimé.`);
      renderSelect();
      await select(list.length ? String(list[0].id) : ALL);
    } catch (err) {
      notify('error', errorMessage(err));
    }
  }

  // --- Branchement ----------------------------------------------------------

  $('dashboard-select').addEventListener('change', onSelectChange);
  $('btn-new').addEventListener('click', create);
  $('btn-rename').addEventListener('click', rename);
  $('btn-delete').addEventListener('click', remove);
  $('btn-edit').addEventListener('click', () => { notify('info', ''); notify('error', ''); startEdit(); });
  $('btn-save').addEventListener('click', save);
  $('btn-cancel').addEventListener('click', cancelEdit);
  $('btn-add-variable').addEventListener('click', () => {
    const id = Number($('add-variable-select').value);
    if (!id || draft.length >= MAX_WIDGETS || indexOf(id) >= 0) return;
    draft.push({ variableId: id, size: 'md' });
    refresh();
  });

  // Premier affichage : dernier choix mémorisé, sinon premier tableau, sinon vue par défaut.
  (async () => {
    try {
      list = await api.listDashboards();
    } catch (err) {
      notify('error', `Tableaux indisponibles : ${errorMessage(err)} Affichage de toutes les variables.`);
    }
    renderSelect();
    const stored = recall();
    const exists = (v) => v === ALL || list.some((d) => String(d.id) === v);
    await select(exists(stored) && stored ? stored : (list.length ? String(list[0].id) : ALL));
  })();

  return {
    // Appelé par dashboard.js à chaque relecture des variables actives.
    setVariables(vars) {
      catalog = vars;
      const first = !catalogReady;
      catalogReady = true;
      if (first) refresh(); // active les boutons Modifier / Nouveau
      else if (editing) renderEditBar();
    },
  };
}
