const { Router } = require('express');
const asyncHandler = require('./asyncHandler');
const { isDuplicate } = require('./dbErrors');
const { validateTeam } = require('../validation/team');
const { parseId } = require('../validation/common');

const DUPLICATE = 'A team with this name already exists';

// Montée derrière authenticate + requireRole('admin').
function createTeamsRouter({ teamRepo }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await teamRepo.list());
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const { value, error } = validateTeam(req.body);
    if (error) return res.status(400).json({ error });
    try {
      res.status(201).json(await teamRepo.create(value.name));
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: DUPLICATE });
      throw err;
    }
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const team = await teamRepo.findById(id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    res.json(team);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { value, error } = validateTeam(req.body);
    if (error) return res.status(400).json({ error });
    try {
      if (!(await teamRepo.rename(id, value.name))) return res.status(404).json({ error: 'Team not found' });
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: DUPLICATE });
      throw err;
    }
    res.json(await teamRepo.findById(id));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (!(await teamRepo.remove(id))) return res.status(404).json({ error: 'Team not found' });
    res.status(204).end();
  }));

  router.put('/:id/members/:userId', asyncHandler(async (req, res) => {
    const teamId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (!teamId || !userId) return res.status(400).json({ error: 'Invalid id' });
    if (!(await teamRepo.addMember(teamId, userId))) return res.status(404).json({ error: 'Team or user not found' });
    res.status(204).end();
  }));

  router.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
    const teamId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (!teamId || !userId) return res.status(400).json({ error: 'Invalid id' });
    await teamRepo.removeMember(teamId, userId);
    res.status(204).end();
  }));

  return router;
}

module.exports = { createTeamsRouter };
