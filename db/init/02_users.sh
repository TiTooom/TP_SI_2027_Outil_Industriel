#!/bin/bash
# Crée les comptes SQL applicatifs avec des droits minimaux.
# Script shell (et non .sql) car les mots de passe viennent des variables d'environnement.
# Sous-shell : n'altère pas les options du script d'entrée de l'image mariadb qui nous source.
(
  set -eu
  : "${MARIADB_ROOT_PASSWORD:?}" "${DB_API_USER:?}" "${DB_API_PASSWORD:?}" "${DB_POLLER_USER:?}" "${DB_POLLER_PASSWORD:?}"

  # MYSQL_PWD plutôt que -p : le mot de passe n'apparaît pas dans la liste des processus.
  MYSQL_PWD="${MARIADB_ROOT_PASSWORD}" mariadb --protocol=socket -uroot <<EOSQL
-- API : gère la configuration et l'application, lit les mesures sans pouvoir les modifier.
CREATE USER IF NOT EXISTS '${DB_API_USER}'@'%' IDENTIFIED BY '${DB_API_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON config.* TO '${DB_API_USER}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON app.*    TO '${DB_API_USER}'@'%';
GRANT SELECT ON prod.* TO '${DB_API_USER}'@'%';

-- Poller : lit la configuration, ajoute des mesures. Ni UPDATE ni DELETE possibles.
CREATE USER IF NOT EXISTS '${DB_POLLER_USER}'@'%' IDENTIFIED BY '${DB_POLLER_PASSWORD}';
GRANT SELECT ON config.* TO '${DB_POLLER_USER}'@'%';
GRANT INSERT ON prod.measures TO '${DB_POLLER_USER}'@'%';

FLUSH PRIVILEGES;
EOSQL
)
