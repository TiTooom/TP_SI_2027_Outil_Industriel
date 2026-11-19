// Arrondi à la lecture : la base garde le DOUBLE brut, l'API et le CSV masquent les artefacts flottants.
const MAX_DECIMALS = 6;
const MIN_FLOAT_DECIMALS = 3;

// Décimales de l'écriture décimale la plus courte (0.1 -> 1, 1e-7 -> 7, 5 -> 0).
function decimalsOf(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  const [mantissa, exp] = String(n).toLowerCase().split('e');
  const frac = (mantissa.split('.')[1] || '').length;
  return Math.max(0, frac - (exp ? Number(exp) : 0));
}

function decimalsFor(variable) {
  const v = variable || {};
  const base = Math.max(decimalsOf(Number(v.scale)), decimalsOf(Number(v.value_offset)));
  const min = v.data_type === 'float32' ? MIN_FLOAT_DECIMALS : 0;
  return Math.min(MAX_DECIMALS, Math.max(base, min));
}

function roundValue(value, variable) {
  if (value === null || value === undefined) return null;
  const rounded = Number(Number(value).toFixed(decimalsFor(variable)));
  return rounded === 0 ? 0 : rounded; // évite -0
}

module.exports = { roundValue, decimalsFor };
