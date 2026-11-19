// Traduction des erreurs serveur (anglais) en messages d'interface clairs.
const KNOWN = {
  'Invalid credentials': 'Identifiant ou mot de passe incorrect.',
  'Wrong current password': 'Le mot de passe actuel est incorrect.',
  'Cannot delete yourself': 'Vous ne pouvez pas supprimer votre propre compte.',
  'Cannot remove the last admin': 'Impossible : il doit rester au moins un administrateur.',
  'Insufficient role': 'Droits insuffisants pour cette action.',
};

export function errorMessage(err) {
  if (err.status === 429) {
    const wait = Number(err.retryAfter);
    const delay = wait > 0 ? ` Réessayez dans ${Math.ceil(wait / 60)} min.` : ' Réessayez plus tard.';
    return `Trop de tentatives.${delay}`;
  }
  if (err.status === 403) return KNOWN[err.message] ?? KNOWN['Insufficient role'];
  if (err.status === 409) return KNOWN[err.message] ?? `Conflit : ${err.message} (déjà utilisé ou règle de gestion).`;
  return KNOWN[err.message] ?? err.message;
}
