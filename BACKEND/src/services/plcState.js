// État de connexion d'un automate tel qu'exposé par /api/plcs/status.
const UNKNOWN_STATE = Object.freeze({ state: 'unknown', last_error: null, last_success_at: null, last_attempt_at: null });

const TIMEOUT = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const REFUSED = new Set(['ECONNREFUSED']);
const UNREACHABLE = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE']);

// Catégorie grossière : le message brut d'une erreur réseau peut révéler IP et ports internes.
function classifyError(err) {
  const code = err.code || err.errno;
  if (TIMEOUT.has(code)) return 'timeout';
  if (REFUSED.has(code)) return 'refused';
  if (UNREACHABLE.has(code)) return 'unreachable';
  return 'protocol';
}

module.exports = { UNKNOWN_STATE, classifyError };
