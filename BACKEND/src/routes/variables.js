const { Router } = require('express');
const asyncHandler = require('./asyncHandler');
const { validateVariable, validateVariablePatch } = require('../validation/variable');
const { parseId } = require('../validation/common');
const { validateMeasuresQuery } = require('../validation/measures');
const { roundValue } = require('../services/roundValue');

const { isDuplicate } = require('./dbErrors');
const { MAX_VARIABLES } = require('../config/limits');
const DUPLICATE = 'A variable with this name already exists on this PLC';
const BAD_PLC = 'plc_id does not match an existing PLC';

// Dépendances injectées : repositories et service de relevé.
function createVariablesRouter({ variableRepo, plcRepo, measureRepo, poller }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    let plcId;
    if (req.query.plc_id !== undefined) {
      plcId = parseId(String(req.query.plc_id));
      if (!plcId) return res.status(400).json({ error: 'plc_id must be a positive integer' });
    }
    const flag = req.query.include_deleted;
    if (flag !== undefined && flag !== '1' && flag !== '0') {
      return res.status(400).json({ error: 'include_deleted must be 0 or 1' });
    }
    res.json(await variableRepo.list(plcId, flag === '1'));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const { value, error } = validateVariable(req.body);
    if (error) return res.status(400).json({ error });
    if (!(await plcRepo.findById(value.plc_id))) return res.status(400).json({ error: BAD_PLC });
    if ((await variableRepo.count()) >= MAX_VARIABLES) {
      return res.status(409).json({ error: `Variable limit reached (${MAX_VARIABLES})` });
    }
    try {
      const created = await variableRepo.create(value);
      await poller.syncVariable(created.id);
      res.status(201).json(created);
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: DUPLICATE });
      throw err;
    }
  }));

  // Doit rester déclarée avant '/:id', sinon « latest » serait pris pour un identifiant.
  router.get('/latest', asyncHandler(async (req, res) => {
    res.json(await measureRepo.findLatestOfActiveVariables());
  }));

  router.get('/:id/latest', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const variable = await variableRepo.findById(id);
    if (!variable) return res.status(404).json({ error: 'Variable not found' });
    const measure = await measureRepo.findLatest(id);
    if (!measure) return res.status(404).json({ error: 'No measure yet' });
    res.json({ ...measure, value: roundValue(measure.value, variable) });
  }));

  router.get('/:id/measures', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { value, error } = validateMeasuresQuery(req.query);
    if (error) return res.status(400).json({ error });
    // Variables supprimées incluses : aperçu d'historique avant export.
    const variable = await variableRepo.findByIdIncludingDeleted(id);
    if (!variable) return res.status(404).json({ error: 'Variable not found' });
    const measures = (await measureRepo.findRange(id, value.from, value.to, value.limit))
      .map((m) => ({ ...m, value: roundValue(m.value, variable) }));
    res.json({
      variable_id: id,
      from: value.from.toISOString(),
      to: value.to.toISOString(),
      count: measures.length,
      measures,
    });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const variable = await variableRepo.findById(id);
    if (!variable) return res.status(404).json({ error: 'Variable not found' });
    res.json(variable);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { value, error } = validateVariable(req.body);
    if (error) return res.status(400).json({ error });
    if (!(await variableRepo.findById(id))) return res.status(404).json({ error: 'Variable not found' });
    if (!(await plcRepo.findById(value.plc_id))) return res.status(400).json({ error: BAD_PLC });
    try {
      const updated = await variableRepo.update(id, value);
      if (!updated) return res.status(404).json({ error: 'Variable not found' });
      await poller.syncVariable(id);
      res.json(updated);
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: DUPLICATE });
      throw err;
    }
  }));

  // Exploitation (technician) : activer/désactiver une mesure et changer sa fréquence, rien d'autre.
  router.patch('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { value, error } = validateVariablePatch(req.body);
    if (error) return res.status(400).json({ error });
    const updated = await variableRepo.patch(id, value);
    if (!updated) return res.status(404).json({ error: 'Variable not found' });
    await poller.syncVariable(id);
    res.json(updated);
  }));

  // Suppression logique : l'historique des mesures est conservé.
  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (!(await variableRepo.softDelete(id))) return res.status(404).json({ error: 'Variable not found' });
    await poller.syncVariable(id);
    res.status(204).end();
  }));

  return router;
}

module.exports = { createVariablesRouter };
