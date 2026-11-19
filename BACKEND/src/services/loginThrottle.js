// Anti brute-force en mémoire : 5 échecs par (IP, username), 30 par IP, 20 par username seul (toutes IP) sur 15 min.
// Le compteur par username ignore l'IP : il reste efficace si l'attaquant fait varier son adresse source.
// En mémoire = remis à zéro au redémarrage ; acceptable pour un outil LAN, sans dépendance supplémentaire.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PAIR = 5;
const MAX_IP = 30;
const MAX_USER = 20;
const MAX_ENTRIES = 10000;

function createLoginThrottle({ now = Date.now } = {}) {
  const entries = new Map(); // clé -> { count, since }

  const pairKey = (ip, username) => `p|${ip}|${String(username).toLowerCase()}`;
  const ipKey = (ip) => `i|${ip}`;
  const userKey = (username) => `u|${String(username).toLowerCase()}`;

  function live(key) {
    const e = entries.get(key);
    if (e && now() - e.since >= WINDOW_MS) { entries.delete(key); return null; }
    return e || null;
  }

  function prune() {
    if (entries.size < MAX_ENTRIES) return;
    for (const key of [...entries.keys()]) live(key);
    // Toujours trop plein : on évince les plus anciennes (Map = ordre d'insertion).
    for (const key of entries.keys()) {
      if (entries.size < MAX_ENTRIES) break;
      entries.delete(key);
    }
  }

  // Renvoie { blocked, retryAfterS } sans modifier l'état.
  function check(ip, username) {
    const hits = [[live(pairKey(ip, username)), MAX_PAIR], [live(ipKey(ip)), MAX_IP],
      [live(userKey(username)), MAX_USER]];
    const over = hits.filter(([e, max]) => e && e.count >= max).map(([e]) => e);
    if (over.length === 0) return { blocked: false, retryAfterS: 0 };
    const until = Math.max(...over.map((e) => e.since + WINDOW_MS));
    return { blocked: true, retryAfterS: Math.max(1, Math.ceil((until - now()) / 1000)) };
  }

  function recordFailure(ip, username) {
    prune();
    // Compté pour tout username, existant ou non : le 429 ne révèle rien sur l'existence du compte.
    for (const key of [pairKey(ip, username), ipKey(ip), userKey(username)]) {
      const e = live(key);
      if (e) e.count += 1;
      else entries.set(key, { count: 1, since: now() });
    }
  }

  // Un succès efface uniquement le compteur du couple : le compteur par IP continue de couvrir le balayage de comptes.
  function recordSuccess(ip, username) {
    entries.delete(pairKey(ip, username));
  }

  return { check, recordFailure, recordSuccess };
}

module.exports = { createLoginThrottle, WINDOW_MS, MAX_PAIR, MAX_IP, MAX_USER };
