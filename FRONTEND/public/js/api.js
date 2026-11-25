// Client HTTP partagé : chemins relatifs (nginx proxifie /api), JSON, erreurs normalisées.
const BASE = '/api';
const DEFAULT_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  // status = 0 : backend injoignable ou délai dépassé
  constructor(message, status = 0, retryAfter = null) {
    super(message);
    this.retryAfter = retryAfter;
    this.name = 'ApiError';
    this.status = status;
  }
}

// Décalage horloge serveur - client (ms), tiré de l'en-tête Date (précision 1 s, suffisante pour une fenêtre de 10 min).
let clockOffsetMs = 0;
export const serverNow = () => Date.now() + clockOffsetMs;

// Pages de l'application (hors login) ; sert aussi à valider le paramètre « next » (pas de redirection ouverte).
export const KNOWN_PAGES = ['index.html', 'config.html', 'export.html', 'admin.html'];

// Session expirée ou absente : retour au login en mémorisant la page demandée.
function redirectToLogin() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const next = KNOWN_PAGES.includes(page) ? `?next=${encodeURIComponent(page)}` : '';
  location.replace(`login.html${next}`);
}

// noRedirect : le login lui-même répond 401 sur identifiants erronés, sans quitter la page.
async function request(path, { method = 'GET', body, timeout = DEFAULT_TIMEOUT_MS, noRedirect = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(BASE + path, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const serverDate = Date.parse(res.headers.get('Date') ?? '');
    if (!Number.isNaN(serverDate)) clockOffsetMs = serverDate - Date.now();
    if (res.status === 401 && !noRedirect) redirectToLogin();
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.error ?? `Erreur serveur (HTTP ${res.status})`, res.status, res.headers.get('Retry-After'));
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.name === 'AbortError' ? 'Délai dépassé : le serveur ne répond pas.' : 'Serveur injoignable.');
  } finally {
    clearTimeout(timer);
  }
}

// URL de téléchargement (navigation native) ; check=1 : pré-vérification JSON sans CSV.
export function exportUrl({ variableIds, from, to, check = false }) {
  const qs = new URLSearchParams({ variableIds: variableIds.join(','), from, to });
  if (check) qs.set('check', '1');
  return `${BASE}/export.csv?${qs}`;
}

export const api = {
  health: () => request('/health', { timeout: 4000 }),
  listPlcs: () => request('/plcs'),
  plcStatus: () => request('/plcs/status'),
  createPlc: (plc) => request('/plcs', { method: 'POST', body: plc }),
  updatePlc: (id, plc) => request(`/plcs/${id}`, { method: 'PUT', body: plc }),
  deletePlc: (id) => request(`/plcs/${id}`, { method: 'DELETE' }),
  listVariables: () => request('/variables'),
  createVariable: (v) => request('/variables', { method: 'POST', body: v }),
  updateVariable: (id, v) => request(`/variables/${id}`, { method: 'PUT', body: v }),
  deleteVariable: (id) => request(`/variables/${id}`, { method: 'DELETE' }),
  latestAll: () => request('/variables/latest'),
  listVariablesWithDeleted: () => request('/variables?include_deleted=1'),
  patchVariable: (id, fields) => request(`/variables/${id}`, { method: 'PATCH', body: fields }),
  // Délai étendu : l'envoi attend son tour derrière les lectures de l'automate, puis la relecture de confirmation.
  writeVariable: (id, value) => request(`/variables/${id}/write`, { method: 'POST', body: { value }, timeout: 20000 }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password }, noRedirect: true }),
  logout: () => request('/auth/logout', { method: 'POST', noRedirect: true }),
  me: () => request('/auth/me'),
  changePassword: (current_password, new_password) => request('/auth/password', { method: 'POST', body: { current_password, new_password } }),
  listUsers: () => request('/users'),
  createUser: (u) => request('/users', { method: 'POST', body: u }),
  updateUser: (id, u) => request(`/users/${id}`, { method: 'PUT', body: u }),
  resetPassword: (id, new_password) => request(`/users/${id}/password`, { method: 'PUT', body: { new_password } }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  listTeams: () => request('/teams'),
  getTeam: (id) => request(`/teams/${id}`),
  createTeam: (name) => request('/teams', { method: 'POST', body: { name } }),
  renameTeam: (id, name) => request(`/teams/${id}`, { method: 'PUT', body: { name } }),
  deleteTeam: (id) => request(`/teams/${id}`, { method: 'DELETE' }),
  addMember: (teamId, userId) => request(`/teams/${teamId}/members/${userId}`, { method: 'PUT' }),
  removeMember: (teamId, userId) => request(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
  listDashboards: () => request('/dashboards'),
  getDashboard: (id) => request(`/dashboards/${id}`),
  createDashboard: (d) => request('/dashboards', { method: 'POST', body: d }),
  updateDashboard: (id, d) => request(`/dashboards/${id}`, { method: 'PUT', body: d }),
  deleteDashboard: (id) => request(`/dashboards/${id}`, { method: 'DELETE' }),
  measures: (id, { from, to, limit }) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return request(`/variables/${id}/measures?${qs}`);
  },
};
