const { Router } = require('express');
const asyncHandler = require('./asyncHandler');
const { isDuplicate } = require('./dbErrors');
const { validateNewUser, validateUserUpdate, validateNewPassword } = require('../validation/user');
const { parseId } = require('../validation/common');
const { hashPassword } = require('../services/passwordHasher');

const DUPLICATE = 'Username or e-mail already taken';
const LAST_ADMIN = 'Cannot remove the last admin';

// Montée derrière authenticate + requireRole('admin').
function createUsersRouter({ userRepo, sessionService }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await userRepo.list());
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const { value, error } = validateNewUser(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const created = await userRepo.create({
        username: value.username, email: value.email, role: value.role, passwordHash: await hashPassword(value.password),
      });
      res.status(201).json(created);
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: DUPLICATE });
      throw err;
    }
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const user = await userRepo.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { value, error } = validateUserUpdate(req.body);
    if (error) return res.status(400).json({ error });
    const before = await userRepo.findById(id);
    if (!before) return res.status(404).json({ error: 'User not found' });
    try {
      const status = await userRepo.update(id, value);
      if (status === 'not_found') return res.status(404).json({ error: 'User not found' });
      if (status === 'last_admin') return res.status(409).json({ error: LAST_ADMIN });
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: DUPLICATE });
      throw err;
    }
    // Le rôle est relu en base à chaque requête, mais on coupe aussi les sessions ouvertes par principe.
    if (value.role !== undefined && value.role !== before.role) await sessionService.revokeAllForUser(id);
    res.json(await userRepo.findById(id));
  }));

  router.put('/:id/password', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { value, error } = validateNewPassword(req.body);
    if (error) return res.status(400).json({ error });
    if (!(await userRepo.setPassword(id, await hashPassword(value.new_password)))) {
      return res.status(404).json({ error: 'User not found' });
    }
    await sessionService.revokeAllForUser(id);
    res.status(204).end();
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (id === req.user.id) return res.status(409).json({ error: 'Cannot delete yourself' });
    const status = await userRepo.remove(id);
    if (status === 'not_found') return res.status(404).json({ error: 'User not found' });
    if (status === 'last_admin') return res.status(409).json({ error: LAST_ADMIN });
    await sessionService.revokeAllForUser(id); // redondant avec ON DELETE CASCADE, garde le contrat explicite
    res.status(204).end();
  }));

  return router;
}

module.exports = { createUsersRouter };
