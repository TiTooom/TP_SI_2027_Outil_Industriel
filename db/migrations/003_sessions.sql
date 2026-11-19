-- Migration J5 : sessions d'authentification (idempotent), pour les bases créées avant J5.
-- Identique à db/init/01_schemas.sql. Aucun GRANT : l'utilisateur api a déjà CRUD sur app.* (db/init/02_users.sh).
CREATE TABLE IF NOT EXISTS app.sessions (
  id           CHAR(64)     NOT NULL PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  created_at   DATETIME(3)  NOT NULL,
  last_seen_at DATETIME(3)  NOT NULL,
  expires_at   DATETIME(3)  NOT NULL,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
