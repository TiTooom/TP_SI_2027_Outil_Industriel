// Page de connexion. Message d'erreur volontairement générique (pas d'énumération de comptes).
import { api, KNOWN_PAGES } from './api.js';
import { errorMessage } from './messages.js';

const $ = (id) => document.getElementById(id);

// Redirection uniquement vers une page connue de l'application (pas de redirection ouverte).
function nextPage() {
  const next = new URLSearchParams(location.search).get('next');
  return KNOWN_PAGES.includes(next) ? next : 'index.html';
}

function showError(message) {
  const box = $('login-error');
  box.textContent = message;
  box.hidden = false;
}

// Déjà connecté : inutile d'afficher le formulaire. Toute erreur (401, réseau) laisse le formulaire disponible.
api.meQuiet().then(() => location.replace(nextPage())).catch(() => {});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username || !password) {
    showError('Saisissez votre identifiant et votre mot de passe.');
    return;
  }
  const button = $('login-submit');
  button.disabled = true;
  $('login-error').hidden = true;
  try {
    await api.login(username, password);
    location.replace(nextPage());
  } catch (err) {
    showError(errorMessage(err));
    $('password').value = '';
    $('password').focus();
    button.disabled = false;
  }
});
