const { str, int, isPlainObject } = require('./common');

const SIZES = ['sm', 'md', 'lg'];
const MAX_WIDGETS = 50;
const MAX_LAYOUT_BYTES = 16 * 1024;
const MAX_ID = 4294967295; // INT UNSIGNED

// Réglages fins optionnels d'une carte : largeur en colonnes d'une grille de 12, hauteur du graphique en px,
// couleur de la courbe. `size` reste obligatoire : c'est le repli quand `w` / `h` sont absents.
const WIDTH_RANGE = [1, 12];
const HEIGHT_RANGE = [80, 600];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const WIDGET_KEYS = ['variableId', 'size', 'w', 'h', 'color'];

const hasOnlyKeys = (obj, keys) => Object.keys(obj).every((k) => keys.includes(k));
const intIn = (v, [min, max]) => Number.isInteger(v) && v >= min && v <= max;

function styleError(w, at) {
  if (w.w !== undefined && !intIn(w.w, WIDTH_RANGE)) return `${at}.w must be an integer between ${WIDTH_RANGE.join(' and ')}`;
  if (w.h !== undefined && !intIn(w.h, HEIGHT_RANGE)) return `${at}.h must be an integer between ${HEIGHT_RANGE.join(' and ')}`;
  if (w.color !== undefined && !(typeof w.color === 'string' && COLOR_RE.test(w.color))) {
    return `${at}.color must be a hex color like #4aa3ff`;
  }
  return null;
}

function widgetError(w, index, seen) {
  const at = `layout.widgets[${index}]`;
  if (!isPlainObject(w)) return `${at} must be an object`;
  if (!hasOnlyKeys(w, WIDGET_KEYS)) return `${at} contains unknown keys`;
  if (!Number.isInteger(w.variableId) || w.variableId < 1 || w.variableId > MAX_ID) {
    return `${at}.variableId must be a positive integer`;
  }
  if (!SIZES.includes(w.size)) return `${at}.size must be one of: ${SIZES.join(', ')}`;
  const styleProblem = styleError(w, at);
  if (styleProblem) return styleProblem;
  if (seen.has(w.variableId)) return `${at}.variableId is duplicated`;
  seen.add(w.variableId);
  return null;
}

// Renvoie un message d'erreur ou null. Le layout est stocké tel quel : tout ce qui n'est pas prévu est refusé.
function layoutError(layout) {
  if (!isPlainObject(layout)) return 'layout must be an object';
  if (!hasOnlyKeys(layout, ['version', 'widgets'])) return 'layout contains unknown keys';
  if (layout.version !== 1) return 'layout.version must be 1';
  if (!Array.isArray(layout.widgets)) return 'layout.widgets must be an array';
  if (layout.widgets.length > MAX_WIDGETS) return `layout.widgets must contain at most ${MAX_WIDGETS} items`;
  const seen = new Set();
  for (const [i, w] of layout.widgets.entries()) {
    const err = widgetError(w, i, seen);
    if (err) return err;
  }
  // Filet de sécurité contre les abus (colonne JSON, corps de requête) : 50 widgets légitimes restent bien en dessous.
  if (Buffer.byteLength(JSON.stringify(layout)) > MAX_LAYOUT_BYTES) return 'layout is too large (16 KB max)';
  return null;
}

const emptyLayout = () => ({ version: 1, widgets: [] });

function optionalLayout(body) {
  if (body.layout === undefined || body.layout === null) return { value: undefined };
  const error = layoutError(body.layout);
  return error ? { error } : { value: body.layout };
}

function validateDashboardCreate(body) {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const name = str(body, 'name', { min: 1, max: 100, required: true });
  if (name.error) return { error: name.error };
  const teamId = int(body, 'team_id', { min: 1, max: MAX_ID, fallback: null });
  if (teamId.error) return { error: teamId.error };
  const layout = optionalLayout(body);
  if (layout.error) return { error: layout.error };
  return { value: { name: name.value, teamId: teamId.value, layout: layout.value || emptyLayout() } };
}

// Le propriétaire n'est jamais modifiable : team_id et toute autre clé sont ignorés.
function validateDashboardUpdate(body) {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const name = str(body, 'name', { min: 1, max: 100 });
  if (name.error) return { error: name.error };
  const layout = optionalLayout(body);
  if (layout.error) return { error: layout.error };
  if (name.value === undefined && layout.value === undefined) return { error: 'At least one of name, layout is required' };
  return { value: { name: name.value, layout: layout.value } };
}

module.exports = { validateDashboardCreate, validateDashboardUpdate, layoutError };
