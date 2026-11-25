// Thème clair / sombre : l'attribut data-bs-theme de <html> pilote Bootstrap et les variables CSS.
// Les graphiques Chart.js ne lisent pas le CSS tout seuls : ils écoutent « themechange ».
const KEY = 'theme';

export const getTheme = () => (document.documentElement.getAttribute('data-bs-theme') === 'light' ? 'light' : 'dark');

export function setTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
  try { localStorage.setItem(KEY, theme); } catch { /* stockage indisponible : valable pour cette page seulement */ }
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

export const onThemeChange = (callback) => document.addEventListener('themechange', callback);

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Couleurs à relire à chaque changement de thème (Chart.js ne les suit pas seul).
export function chartColors() {
  return { grid: cssVar('--grid'), muted: cssVar('--muted'), text: cssVar('--text'), accent: cssVar('--accent') };
}
