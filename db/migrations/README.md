# Migrations de base de données

Le numéro 001 correspond à `db/init/` : c'est la base complète, créée au premier démarrage sur un volume vide.
Les migrations (002, 003…) servent aux bases déjà existantes : chaque fichier s'applique à la main, dans l'ordre des numéros.
La commande à utiliser est décrite dans le README principal, section « Mise à jour d'une base déjà créée ».
