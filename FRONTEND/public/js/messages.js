// Traduction des erreurs serveur (anglais) en messages d'interface clairs.
const KNOWN = {
  'Invalid credentials': 'Identifiant ou mot de passe incorrect.',
  'Wrong current password': 'Le mot de passe actuel est incorrect.',
  'Cannot delete yourself': 'Vous ne pouvez pas supprimer votre propre compte.',
  'Cannot remove the last admin': 'Impossible : il doit rester au moins un administrateur.',
  'Dashboard name already used': 'Ce nom de tableau est déjà utilisé.',
  'Dashboard not found': "Ce tableau n'existe plus ou n'est pas accessible.",
  'Team not found': "Équipe introuvable ou vous n'en êtes pas membre.",
  'Insufficient role': 'Droits insuffisants pour cette action.',
  'Authentication required': 'Session expirée : reconnectez-vous.',
  'A PLC with this name already exists': 'Un automate porte déjà ce nom.',
  'PLC has measurement history': "Cet automate a un historique de mesures : suppression impossible.",
  'PLC still has variables, delete them first': "Cet automate a encore des variables : supprimez-les d'abord.",
  'PLC not found': 'Automate introuvable.',
  'Variable not found': 'Variable introuvable.',
  'Variable is not writable': "Cette variable n'est pas modifiable depuis l'interface.",
  'Variable is disabled': 'Cette variable est désactivée : activez-la pour lui envoyer une valeur.',
  'PLC is disabled': 'Cet automate est désactivé.',
  'User not found': 'Utilisateur introuvable.',
  'Team or user not found': 'Équipe ou utilisateur introuvable.',
  'No measure yet': 'Aucune mesure pour le moment.',
  'Invalid id': 'Identifiant invalide.',
  'Invalid JSON body': 'Requête invalide.',
  'Route not found': 'Ressource introuvable.',
  'Cross-origin request refused': 'Requête refusée (origine non autorisée).',
  'Internal server error': 'Erreur interne du serveur. Réessayez plus tard.',
  'Export failed': "Échec de l'export. Réessayez.",
  'Too many concurrent exports, retry later': "Trop d'exports simultanés. Réessayez dans un instant.",
  'Time range must not exceed 7 days': 'La période ne doit pas dépasser 7 jours.',
  'from must be before to': 'La date de début doit précéder la date de fin.',
  'from and to are required': 'Les dates de début et de fin sont requises.',
  'username and password are required': 'Identifiant et mot de passe requis.',
  'username or password too long': 'Identifiant ou mot de passe trop long.',
  'current_password is required': 'Le mot de passe actuel est requis.',
  'host is not allowed': 'Cette adresse n’est pas autorisée.',
  'host must be an IPv4 address or a valid DNS name': 'Adresse invalide : saisissez une IPv4 ou un nom DNS valide.',
};

// Écriture vers l'automate : catégories d'échec réseau et exceptions Modbus renvoyées par le serveur.
const WRITE_FAILURES = {
  timeout: "L'automate n'a pas répondu à temps : l'envoi n'est pas confirmé.",
  refused: "Connexion refusée par l'automate : l'envoi n'a pas eu lieu.",
  unreachable: "Automate injoignable : l'envoi n'a pas eu lieu.",
  protocol: "Erreur de communication avec l'automate : l'envoi n'est pas confirmé.",
};
const MODBUS_EXCEPTIONS = { 1: 'fonction non prise en charge', 2: 'adresse inconnue', 3: 'valeur refusée', 4: "défaut interne de l'automate", 6: 'automate occupé' };
const frNumber = (text) => Number(text).toLocaleString('fr-FR', { maximumFractionDigits: 6 });

// Messages paramétrés : [motif, fabrique du message français].
const PATTERNS = [
  [/^PLC write failed: (timeout|refused|unreachable|protocol)$/, (m) => WRITE_FAILURES[m[1]]],
  [/^PLC refused the write \(Modbus exception (\d+)\)$/, (m) => `L'automate a refusé l'écriture (${MODBUS_EXCEPTIONS[m[1]] ?? `exception Modbus ${m[1]}`}).`],
  [/^Value out of range: must be between (\S+) and (\S+)$/, (m) => `Valeur hors plage : entre ${frNumber(m[1])} et ${frNumber(m[2])} attendu.`],
  [/^A finite number is required$/, () => 'Saisissez un nombre.'],
  [/^A boolean value /, () => 'Valeur invalide.'],
  [/^writable is only allowed/, () => 'Seuls les registres holding et coil peuvent être modifiés : input et discrete sont en lecture seule dans Modbus.'],
  [/^Time range must not exceed (\d+) days$/, (m) => `La période ne doit pas dépasser ${m[1]} jours.`],
  [/^Too many rows \((\d+) > (\d+)\)/, () => "Trop de lignes à exporter : réduisez la période ou le nombre de variables."],
  [/^Variable limit reached \((\d+)\)$/, (m) => `Limite atteinte : ${m[1]} variables maximum.`],
  [/^PLC limit reached \((\d+)\)$/, (m) => `Limite atteinte : ${m[1]} automates maximum.`],
  [/^Dashboard limit reached \((\d+)/, (m) => `Limite atteinte : ${m[1]} tableaux maximum.`],
  [/^Variable not found: /, () => 'Variable introuvable.'],
  [/ must be an integer between (-?\d+) and (-?\d+)$/, (m) => `Valeur invalide : entier entre ${m[1]} et ${m[2]} attendu.`],
  [/ must be between (\d+) and (\d+) characters$/, (m) => `Longueur invalide : entre ${m[1]} et ${m[2]} caractères.`],
  [/ is required$/, () => 'Un champ obligatoire est manquant.'],
  [/ must be a (string|boolean)$/, () => 'Valeur invalide.'],
  [/ must be a finite number/, () => 'Valeur numérique invalide.'],
  [/ must be one of: /, () => 'Valeur non autorisée.'],
  [/ is not a valid date$|ISO 8601/, () => 'Date invalide.'],
  [/^Unknown field: /, () => 'Champ non reconnu.'],
  [/^(data_type|email|enabled|username|plc_id|variableIds|limit|include_deleted|check)/, () => 'Données saisies invalides. Vérifiez le formulaire.'],
];

// Message serveur déjà en français (ApiError réseau/délai) : conservé tel quel.
const isLocal = (err) => !err.status;

// Fonction unique de traduction des erreurs pour toute l'interface.
export function errorMessage(err) {
  if (err.status === 429) {
    const wait = Number(err.retryAfter);
    const delay = wait > 0 ? ` Réessayez dans ${Math.ceil(wait / 60)} min.` : ' Réessayez plus tard.';
    return `Trop de tentatives.${delay}`;
  }
  const msg = err.message ?? '';
  if (isLocal(err)) return msg || 'Une erreur est survenue.';
  if (KNOWN[msg]) return KNOWN[msg];
  for (const [re, build] of PATTERNS) {
    const m = re.exec(msg);
    if (m) return build(m);
  }
  if (err.status === 403) return KNOWN['Insufficient role'];
  if (err.status === 409) return 'Conflit : action impossible (élément déjà utilisé ou règle de gestion).';
  if (err.status === 404) return 'Élément introuvable.';
  if (err.status >= 500) return 'Erreur du serveur. Réessayez plus tard.';
  return 'Une erreur est survenue. Vérifiez les données saisies.';
}
