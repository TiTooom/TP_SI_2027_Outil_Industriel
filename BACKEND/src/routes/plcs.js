const { Router } = require('express');
const asyncHandler = require('./asyncHandler');
const { validatePlc } = require('../validation/plc');
const { parseId } = require('../validation/common');

const { isDuplicate, isReferenced } = require('./dbErrors');
const { UNKNOWN_STATE } = require('../services/plcState');
const { MAX_PLCS } = require('../config/limits');

// Dépendances injectées : repository des automates et service de relevé.
function createPlcsRouter({ plcRepo, poller }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await plcRepo.list());
  }));

  // Déclarée avant /:id, sinon "status" serait pris pour un identifiant.
  router.get('/status', asyncHandler(async (req, res) => {
    const plcs = await plcRepo.list();
    res.json(plcs.map((p) => ({
      plc_id: p.id,
      name: p.name,
      enabled: p.enabled,
      ...(p.enabled ? poller.getPlcState(p.id) : UNKNOWN_STATE),
    })));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const { value, error } = validatePlc(req.body);
    if (error) return res.status(400).json({ error });
    if ((await plcRepo.count()) >= MAX_PLCS) return res.status(409).json({ error: `PLC limit reached (${MAX_PLCS})` });
    try {
      const created = await plcRepo.create(value);
      await poller.syncPlc(created.id);
      res.status(201).json(created);
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: 'A PLC with this name already exists' });
      throw err;
    }
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const plc = await plcRepo.findById(id);
    if (!plc) return res.status(404).json({ error: 'PLC not found' });
    res.json(plc);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { value, error } = validatePlc(req.body);
    if (error) return res.status(400).json({ error });
    if (!(await plcRepo.findById(id))) return res.status(404).json({ error: 'PLC not found' });
    try {
      const updated = await plcRepo.update(id, value);
      await poller.syncPlc(id);
      res.json(updated);
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: 'A PLC with this name already exists' });
      throw err;
    }
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (!(await plcRepo.findById(id))) return res.status(404).json({ error: 'PLC not found' });
    if ((await plcRepo.countActiveVariables(id)) > 0) {
      return res.status(409).json({ error: 'PLC still has variables, delete them first' });
    }
    try {
      await plcRepo.remove(id);
    } catch (err) {
      // Les variables supprimées logiquement référencent encore l'automate : l'historique est conservé.
      if (isReferenced(err)) return res.status(409).json({ error: 'PLC has measurement history' });
      throw err;
    }
    await poller.syncPlc(id);
    res.status(204).end();
  }));

  return router;
}

module.exports = { createPlcsRouter };
