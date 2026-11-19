const { Router } = require('express');
const asyncHandler = require('./asyncHandler');
const { isDuplicate } = require('./dbErrors');
const { validateDashboardCreate, validateDashboardUpdate } = require('../validation/dashboard');
const { parseId } = require('../validation/common');
const { hasRole } = require('../config/roles');
const { MAX_DASHBOARDS_PER_OWNER } = require('../config/limits');

const FORBIDDEN = { error: 'Insufficient role' };
const DUPLICATE = { error: 'Dashboard name already used' };

const isAdmin = (user) => user.role === 'admin';
const canTeamEdit = (user) => hasRole(user.role, 'engineer');

function canView(d, user, teamIds) {
  if (isAdmin(user)) return true;
  return d.scope === 'user' ? d.owner_user_id === user.id : teamIds.includes(d.owner_team_id);
}

// Appelé seulement sur un tableau visible : pour une équipe, la visibilité implique l'appartenance.
function canEdit(d, user) {
  if (isAdmin(user)) return true;
  return d.scope === 'user' ? d.owner_user_id === user.id : canTeamEdit(user);
}

const present = (d, user) => ({ ...d, can_edit: canEdit(d, user) });

// Montée derrière authenticate : les droits dépendent du rôle et des équipes de la session (req.user),
// jamais du corps de la requête.
function createDashboardsRouter({ dashboardRepo }) {
  const router = Router();

  // Renvoie le tableau visible ou répond 400/404 (pas de fuite d'existence).
  async function loadVisible(req, res) {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'Invalid id' }); return null; }
    const d = await dashboardRepo.findById(id);
    const teamIds = d && d.scope === 'team' && !isAdmin(req.user) ? await dashboardRepo.memberTeamIds(req.user.id) : [];
    if (!d || !canView(d, req.user, teamIds)) { res.status(404).json({ error: 'Dashboard not found' }); return null; }
    return d;
  }

  // Détermine le propriétaire du nouveau tableau ou répond 404/403.
  async function resolveOwner(req, res, teamId) {
    if (!teamId) return { userId: req.user.id };
    const known = isAdmin(req.user)
      ? await dashboardRepo.teamExists(teamId)
      : (await dashboardRepo.memberTeamIds(req.user.id)).includes(teamId);
    if (!known) { res.status(404).json({ error: 'Team not found' }); return null; }
    if (!canTeamEdit(req.user)) { res.status(403).json(FORBIDDEN); return null; }
    return { teamId };
  }

  router.get('/', asyncHandler(async (req, res) => {
    const rows = isAdmin(req.user) ? await dashboardRepo.listAll() : await dashboardRepo.listForUser(req.user.id);
    res.json(rows.map((d) => present(d, req.user)));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const { value, error } = validateDashboardCreate(req.body);
    if (error) return res.status(400).json({ error });
    const owner = await resolveOwner(req, res, value.teamId);
    if (!owner) return undefined;
    try {
      // Le plafond est vérifié dans l'INSERT lui-même (atomique côté SQL) : create renvoie null s'il est atteint.
      const d = await dashboardRepo.create({ name: value.name, layout: value.layout, max: MAX_DASHBOARDS_PER_OWNER, ...owner });
      if (!d) return res.status(409).json({ error: `Dashboard limit reached (${MAX_DASHBOARDS_PER_OWNER} per owner)` });
      return res.status(201).json(present(d, req.user));
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json(DUPLICATE);
      throw err;
    }
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const d = await loadVisible(req, res);
    if (d) res.json(present(d, req.user));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const d = await loadVisible(req, res);
    if (!d) return undefined;
    if (!canEdit(d, req.user)) return res.status(403).json(FORBIDDEN);
    const { value, error } = validateDashboardUpdate(req.body);
    if (error) return res.status(400).json({ error });
    try {
      return res.json(present(await dashboardRepo.update(d.id, value), req.user));
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json(DUPLICATE);
      throw err;
    }
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const d = await loadVisible(req, res);
    if (!d) return undefined;
    if (!canEdit(d, req.user)) return res.status(403).json(FORBIDDEN);
    await dashboardRepo.remove(d.id);
    return res.status(204).end();
  }));

  return router;
}

module.exports = { createDashboardsRouter };
