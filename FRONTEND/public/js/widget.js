// Réglages d'une carte de tableau (largeur, hauteur du graphique, couleur de la courbe).
// Mêmes bornes que BACKEND/src/validation/dashboard.js : le serveur refuse tout ce qui en sort.
export const SIZES = ['sm', 'md', 'lg'];
export const SIZE_WIDTH = { sm: 4, md: 8, lg: 12 }; // colonnes d'une grille de 12
export const WIDTH = { min: 2, max: 12 };
export const HEIGHT = { min: 80, max: 600, step: 20, fallback: 140 };
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export const widthOf = (widget) => widget.w ?? SIZE_WIDTH[widget.size];
export const heightOf = (widget) => widget.h ?? HEIGHT.fallback;

// `size` reste enregistré (repli pour un ancien affichage) : on le garde cohérent avec la largeur.
export const sizeForWidth = (w) => (w <= 4 ? 'sm' : w <= 8 ? 'md' : 'lg');

const inRange = (v, { min, max }) => Number.isInteger(v) && v >= min && v <= max;

// Ne garde que des valeurs valides : un tableau enregistré ailleurs ne doit jamais casser l'affichage.
export function normalizeWidget(raw) {
  const widget = { variableId: raw.variableId, size: SIZES.includes(raw.size) ? raw.size : 'md' };
  if (inRange(raw.w, { min: 1, max: WIDTH.max })) widget.w = raw.w;
  if (inRange(raw.h, HEIGHT)) widget.h = raw.h;
  if (typeof raw.color === 'string' && COLOR_RE.test(raw.color)) widget.color = raw.color.toLowerCase();
  return widget;
}
