// Appliqué avant l'affichage de la page (script synchrone dans <head>) : évite le flash sombre -> clair.
// Fichier à part car la CSP de nginx interdit les scripts inline.
try {
  document.documentElement.setAttribute('data-bs-theme', localStorage.getItem('theme') === 'light' ? 'light' : 'dark');
} catch {
  // stockage indisponible : thème sombre par défaut (déjà posé dans le HTML)
}
