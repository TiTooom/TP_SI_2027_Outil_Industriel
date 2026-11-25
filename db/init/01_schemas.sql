-- Schémas séparés par domaine : configuration, données de production, application.
-- Exécuté une seule fois par l'image mariadb au premier démarrage (volume vide).

CREATE DATABASE IF NOT EXISTS config CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS prod   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS app    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- config
CREATE TABLE IF NOT EXISTS config.plcs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100)      NOT NULL,
  host        VARCHAR(255)      NOT NULL COMMENT 'IP ou nom DNS de l''automate',
  port        SMALLINT UNSIGNED NOT NULL DEFAULT 502,
  unit_id     TINYINT UNSIGNED  NOT NULL DEFAULT 1,
  enabled     BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_plcs_name UNIQUE (name),
  CONSTRAINT ck_plcs_port CHECK (port > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS config.variables (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plc_id        INT UNSIGNED NOT NULL,
  name          VARCHAR(100) NOT NULL,
  register_type ENUM('holding','input','coil','discrete') NOT NULL DEFAULT 'holding',
  address       SMALLINT UNSIGNED NOT NULL,
  data_type     ENUM('int16','uint16','int32','uint32','float32','bool') NOT NULL DEFAULT 'int16',
  scale         DOUBLE       NOT NULL DEFAULT 1,
  value_offset  DOUBLE       NOT NULL DEFAULT 0,
  unit          VARCHAR(20)  NULL,
  frequency_s   INT UNSIGNED NOT NULL DEFAULT 5,
  enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
  writable      BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Valeur modifiable depuis l''interface (écriture vers l''automate)',
  deleted_at    TIMESTAMP    NULL DEFAULT NULL COMMENT 'Suppression logique : conserve l''historique',
  -- 1 si active, NULL si supprimée : NULL est distinct dans un UNIQUE, d'où unicité du nom parmi les actives seulement
  active_key    TINYINT      AS (IF(deleted_at IS NULL, 1, NULL)) PERSISTENT,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_variables_plc FOREIGN KEY (plc_id) REFERENCES config.plcs(id) ON DELETE RESTRICT,
  CONSTRAINT uq_variables_plc_name UNIQUE (plc_id, name, active_key),
  CONSTRAINT ck_variables_frequency CHECK (frequency_s >= 1),
  -- Modbus : les registres input (FC4) et discrete (FC2) sont en lecture seule, un automate refuserait l'écriture.
  CONSTRAINT ck_variables_writable CHECK (NOT writable OR register_type IN ('holding', 'coil')),
  INDEX idx_variables_active (deleted_at, enabled)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- prod
-- Écrite uniquement par le compte « poller » (INSERT seul). Jamais modifiée par l'API.
CREATE TABLE IF NOT EXISTS prod.measures (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  variable_id INT UNSIGNED NOT NULL,
  ts          DATETIME(3)  NOT NULL,
  value       DOUBLE       NULL COMMENT 'NULL si la lecture a échoué',
  quality     ENUM('good','bad') NOT NULL DEFAULT 'good',
  CONSTRAINT fk_measures_variable FOREIGN KEY (variable_id) REFERENCES config.variables(id) ON DELETE RESTRICT,
  INDEX idx_measures_variable_ts (variable_id, ts)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- app
CREATE TABLE IF NOT EXISTS app.users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL,
  email         VARCHAR(255) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','engineer','technician','viewer') NOT NULL DEFAULT 'viewer',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email UNIQUE (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app.teams (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_teams_name UNIQUE (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app.team_members (
  team_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES app.teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app.dashboards (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  owner_user_id INT UNSIGNED NULL,
  owner_team_id INT UNSIGNED NULL,
  layout        JSON         NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dashboards_user_name (owner_user_id, name),
  UNIQUE KEY uq_dashboards_team_name (owner_team_id, name),
  CONSTRAINT fk_dashboards_user FOREIGN KEY (owner_user_id) REFERENCES app.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dashboards_team FOREIGN KEY (owner_team_id) REFERENCES app.teams(id) ON DELETE CASCADE,
  -- Un dashboard appartient soit à un utilisateur (mode perso), soit à une équipe (mode équipe).
  CONSTRAINT ck_dashboards_owner CHECK ((owner_user_id IS NULL) <> (owner_team_id IS NULL))
) ENGINE=InnoDB;

-- Sessions d'authentification : `id` = SHA-256 hex du jeton (le jeton en clair n'est jamais stocké). Dates en UTC.
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
