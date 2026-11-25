-- Migration : variables modifiables depuis l'interface, donc écrites vers l'automate (idempotent).
-- À appliquer sur une base créée avant cette fonction ; db/init ne s'exécute que sur volume vierge.
-- Aucun GRANT : l'utilisateur api a déjà CRUD sur config.*, le poller y a SELECT (db/init/02_users.sh).
ALTER TABLE config.variables
  ADD COLUMN IF NOT EXISTS writable BOOLEAN NOT NULL DEFAULT FALSE
  COMMENT 'Valeur modifiable depuis l''interface (écriture vers l''automate)' AFTER enabled;

-- Modbus : les registres input (FC4) et discrete (FC2) sont en lecture seule, un automate refuserait l'écriture.
ALTER TABLE config.variables
  ADD CONSTRAINT IF NOT EXISTS ck_variables_writable CHECK (NOT writable OR register_type IN ('holding', 'coil'));
