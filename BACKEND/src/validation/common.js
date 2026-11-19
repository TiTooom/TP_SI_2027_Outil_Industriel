// Briques de validation partagées. Chaque validateur renvoie { value } ou { error }.
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function str(body, field, { min = 0, max, required = false, fallback }) {
  const v = body[field];
  if (v === undefined || v === null) {
    return required ? { error: `${field} is required` } : { value: fallback };
  }
  if (typeof v !== 'string') return { error: `${field} must be a string` };
  const trimmed = v.trim();
  if (trimmed.length < min || trimmed.length > max) {
    return { error: `${field} must be between ${min} and ${max} characters` };
  }
  return { value: trimmed };
}

function int(body, field, { min, max, required = false, fallback }) {
  const v = body[field];
  if (v === undefined || v === null) {
    return required ? { error: `${field} is required` } : { value: fallback };
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    return { error: `${field} must be an integer between ${min} and ${max}` };
  }
  return { value: v };
}

function num(body, field, { nonZero = false, fallback }) {
  const v = body[field];
  if (v === undefined || v === null) return { value: fallback };
  if (typeof v !== 'number' || !Number.isFinite(v) || (nonZero && v === 0)) {
    return { error: `${field} must be a finite number${nonZero ? ' different from 0' : ''}` };
  }
  return { value: v };
}

function bool(body, field, fallback) {
  const v = body[field];
  if (v === undefined || v === null) return { value: fallback };
  if (typeof v !== 'boolean') return { error: `${field} must be a boolean` };
  return { value: v };
}

function oneOf(body, field, allowed) {
  const v = body[field];
  if (v === undefined || v === null) return { error: `${field} is required` };
  if (!allowed.includes(v)) return { error: `${field} must be one of: ${allowed.join(', ')}` };
  return { value: v };
}

// Exécute les champs dans l'ordre et s'arrête à la première erreur.
function collect(body, spec) {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const value = {};
  for (const [field, run] of Object.entries(spec)) {
    const r = run(body);
    if (r.error) return { error: r.error };
    value[field] = r.value;
  }
  return { value };
}

// Identifiant d'URL : entier strictement positif, sinon null.
function parseId(raw) {
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

module.exports = { str, int, num, bool, oneOf, collect, parseId, isPlainObject };
