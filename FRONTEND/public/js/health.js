// Affiche l'état de /api/health et le rafraîchit périodiquement.
const REFRESH_MS = 5000;

const LABELS = { up: 'Connectée', down: 'Injoignable' };

function setStatus(key, ok, text) {
  document.querySelector(`[data-key="${key}"]`).className = `dot ${ok ? 'ok' : 'ko'}`;
  document.querySelector(`[data-text="${key}"]`).textContent = text;
}

async function refresh() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const body = await res.json();
    setStatus('app', true, 'En ligne');
    for (const key of ['api', 'poller']) {
      const state = body.db?.[key];
      setStatus(key, state === 'up', LABELS[state] ?? 'Inconnu');
    }
  } catch {
    setStatus('app', false, 'Hors ligne');
    setStatus('api', false, 'Inconnu');
    setStatus('poller', false, 'Inconnu');
  }
  document.getElementById('last-check').textContent =
    `Dernière vérification : ${new Date().toLocaleTimeString('fr-FR')}`;
}

refresh();
setInterval(refresh, REFRESH_MS);
