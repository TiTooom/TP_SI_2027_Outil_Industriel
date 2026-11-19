// Formatage des valeurs et des dates pour l'affichage (locale française).
const valueFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function formatValue(value) {
  return value === null || value === undefined ? '—' : valueFmt.format(value);
}

export function formatClock(ms) {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
