// Crée le premier compte admin depuis l'environnement quand app.users est vide (déploiement initial).
const { hashPassword, passwordPolicyError } = require('./passwordHasher');

const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bootstrapOnce({ userRepo, username, password, log }) {
  if ((await userRepo.count()) > 0) return false;
  const problem = !USERNAME_RE.test(username) ? 'ADMIN_USERNAME is invalid' : passwordPolicyError(password, 'ADMIN_PASSWORD');
  if (problem) {
    log.error(`Admin bootstrap skipped: ${problem}`);
    return false;
  }
  await userRepo.create({ username, email: null, passwordHash: await hashPassword(password), role: 'admin' });
  // Le mot de passe n'est jamais journalisé.
  log.log(`Initial admin account created: ${username}`);
  return true;
}

// Ne lève jamais : un échec d'amorçage ne doit pas empêcher le backend de démarrer. Renvoie true si créé.
// La base peut ne pas être prête au démarrage : les erreurs SQL sont retentées quelques fois.
async function bootstrapAdmin({ userRepo, username, password, log = console, attempts = 12, retryDelayMs = 5000 }) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await bootstrapOnce({ userRepo, username, password, log });
    } catch (err) {
      log.error(`Admin bootstrap attempt ${i}/${attempts} failed: ${err.message}`);
      if (i < attempts) await sleep(retryDelayMs);
    }
  }
  return false;
}

module.exports = { bootstrapAdmin };
