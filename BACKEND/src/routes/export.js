const { Router } = require('express');
const asyncHandler = require('./asyncHandler');
const { validateExportQuery } = require('../validation/export');
const exportService = require('../services/exportService');

function createExportRouter({ variableRepo, measureRepo }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const { value, error } = validateExportQuery(req.query);
    if (error) return res.status(400).json({ error });
    const { ids, from, to, check } = value;

    const release = exportService.acquireSlot();
    if (!release) {
      res.set('Retry-After', String(exportService.RETRY_AFTER_S));
      return res.status(429).json({ error: 'Too many concurrent exports, retry later' });
    }
    res.once('close', release); // se déclenche aussi en cas d'erreur ou d'abandon client

    // Les variables supprimées restent exportables : seul un id jamais créé donne 404.
    const variables = await variableRepo.findManyIncludingDeleted(ids);
    const known = new Set(variables.map((v) => v.id));
    const missing = ids.find((id) => !known.has(id));
    if (missing !== undefined) return res.status(404).json({ error: `Variable not found: ${missing}` });

    const counted = await exportService.checkRows(measureRepo, ids, from, to);
    if (counted.error) return res.status(400).json({ error: counted.error });
    if (check) return res.json({ rows: counted.rows });

    await exportService.streamCsv({ measureRepo, variables, ids, from, to, res });
  }));

  return router;
}

module.exports = { createExportRouter };
