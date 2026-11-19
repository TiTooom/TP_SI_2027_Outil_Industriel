-- Migration J6 : unicité du nom d'un dashboard par propriétaire (idempotent).
-- À appliquer sur une base existante ; db/init ne s'exécute que sur volume vierge.
ALTER TABLE app.dashboards ADD UNIQUE INDEX IF NOT EXISTS uq_dashboards_user_name (owner_user_id, name);
ALTER TABLE app.dashboards ADD UNIQUE INDEX IF NOT EXISTS uq_dashboards_team_name (owner_team_id, name);
