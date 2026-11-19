// Client HTTP partagé : chemins relatifs (nginx proxifie /api), JSON, erreurs normalisées.
const BASE = '/api';
const DEFAULT_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  // status = 0 : backend injoignable ou délai dépassé
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Décalage horloge serveur - client (ms), tiré de l'en-tête Date (précision 1 s, suffisante pour une fenêtre de 10 min).
let clockOffsetMs = 0;
export const serverNow = () => Date.now() + clockOffsetMs;

async function request(path, { method = 'GET', body, timeout = DEFAULT_TIMEOUT_MS } = {}) {
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
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.error ?? `Erreur serveur (HTTP ${res.status})`, res.status);
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
  measures: (id, { from, to, limit }) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return request(`/variables/${id}/measures?${qs}`);
  },
};
