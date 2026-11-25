// Envoi d'une valeur à l'automate depuis la carte d'une variable modifiable (rôle technician minimum).
// Le serveur reste l'autorité (droits, bornes du type de donnée, état de l'automate) : ici, la saisie
// et un retour lisible, qui distingue « confirmé par l'automate » de « envoyé mais pas relu ».
import { api } from './api.js';
import { el } from './dom.js';
import { errorMessage } from './messages.js';
import { formatValue } from './format.js';

const SAME = 1e-9; // les deux valeurs sont déjà arrondies par le serveur : une égalité stricte suffirait, sauf bruit flottant

const clock = () => new Date().toLocaleTimeString('fr-FR');

// onSent : appelé après un envoi réussi (la carte rafraîchit ses mesures sans attendre le prochain relevé).
export function buildWriteForm(variable, onSent) {
  const { name } = variable;
  const isBit = variable.data_type === 'bool';
  const unit = variable.unit ? ` ${variable.unit}` : '';
  const status = el('div', { className: 'write-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const root = el('form', { className: 'write-row', attrs: { 'aria-label': `Envoyer une valeur à l'automate pour ${name}`, novalidate: '' } });
  const controls = [];

  const show = (kind, text) => {
    status.className = kind ? `write-status ${kind}` : 'write-status';
    status.textContent = text;
  };

  // Ce que l'automate contient vraiment après l'envoi : « confirmé » seulement si la relecture le prouve.
  function report(res) {
    const sent = isBit ? (res.written ? 'activé' : 'désactivé') : `${formatValue(res.written)}${unit}`;
    if (res.read_back === null) {
      show('warn', `${clock()} · Envoyé : ${sent}, mais la relecture a échoué. Vérifiez la prochaine mesure.`);
    } else if (Math.abs(res.read_back - res.written) > SAME) {
      const held = isBit ? (res.read_back ? 'activé' : 'désactivé') : `${formatValue(res.read_back)}${unit}`;
      show('warn', `${clock()} · Envoyé : ${sent}, mais l'automate contient ${held}.`);
    } else {
      show('ok', `${clock()} · Envoyé : ${sent} (confirmé par l'automate).`);
    }
  }

  async function send(value) {
    for (const c of controls) c.disabled = true;
    show('', "Envoi à l'automate…");
    try {
      report(await api.writeVariable(variable.id, value));
      onSent?.();
    } catch (err) {
      show('ko', errorMessage(err));
    } finally {
      for (const c of controls) c.disabled = false;
    }
  }

  let input = null;
  if (isBit) {
    const command = (label, value, cls, testId) => {
      const button = el('button', { className: `btn btn-sm ${cls}`, text: label, attrs: { type: 'button', 'data-testid': testId, 'aria-label': `${label} ${name}` } });
      button.addEventListener('click', () => send(value));
      controls.push(button);
      return button;
    };
    root.append(el('span', { className: 'write-label', text: 'Commande' }),
      command('Activer', true, 'btn-primary', 'write-on'), command('Désactiver', false, 'btn-outline-light', 'write-off'));
  } else {
    input = el('input', {
      className: 'form-control form-control-sm write-input',
      attrs: { type: 'number', step: 'any', inputmode: 'decimal', 'aria-label': `Nouvelle valeur pour ${name}`, 'data-testid': 'write-input' },
    });
    const submit = el('button', { className: 'btn btn-primary btn-sm', text: 'Envoyer', attrs: { type: 'submit', 'data-testid': 'write-send' } });
    controls.push(input, submit);
    root.append(el('span', { className: 'write-label', text: 'Écrire' }), input);
    if (variable.unit) root.append(el('span', { className: 'write-unit', text: variable.unit }));
    root.append(submit);
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value.trim() === '' ? NaN : Number(input.value);
      if (!Number.isFinite(value)) return show('ko', 'Saisissez un nombre.');
      send(value).then(() => { if (status.classList.contains('ok')) input.value = ''; });
    });
  }
  root.append(status);

  return {
    root,
    // La valeur actuelle sert d'indication dans le champ vide : on voit ce qu'on s'apprête à remplacer.
    setCurrent(value) {
      if (input) input.placeholder = value === null || value === undefined ? '' : formatValue(value);
    },
  };
}
