// POST /api/variables/:id/write { value } : envoie une valeur à l'automate (rôle technician).
// Seules les variables déclarées « modifiables » (holding ou coil) sont concernées ; les mesures stockées
// ne sont jamais modifiées par cette route : le service de relevé relit la valeur et l'enregistre lui-même.
const { Router } = require('express');
const asyncHandler = require('./asyncHandler');
const { parseId, isPlainObject } = require('../validation/common');
const { encodeValue } = require('../services/modbusDecoder');
const { classifyError } = require('../services/plcState');
const { roundValue } = require('../services/roundValue');

// Catégorie d'échec réseau -> statut HTTP (504 : l'automate n'a pas répondu à temps).
const NETWORK_STATUS = { timeout: 504, refused: 502, unreachable: 502, protocol: 502 };

// Dépendances injectées : repositories, service de relevé (seul à parler Modbus) et journal.
function createVariableWriteRouter({ variableRepo, plcRepo, poller, logger = console }) {
  const router = Router({ mergeParams: true });

  // Une écriture agit sur le procédé : on garde la trace de qui a envoyé quoi, succès comme échec.
  const audit = (req, variable, outcome) => logger.info(
    `PLC write by ${req.user.username} (${req.user.role}): variable ${variable.id} ${JSON.stringify(variable.name)} = ${outcome}`,
  );

  function failure(err) {
    if (err.code === 'NOT_WRITABLE') return { status: 409, error: 'Variable is not writable' };
    if (err.code === 'INVALID_VALUE') return { status: 400, error: err.message };
    if (err.modbusCode !== undefined) return { status: 502, error: `PLC refused the write (Modbus exception ${err.modbusCode})` };
    const category = classifyError(err);
    return { status: NETWORK_STATUS[category], error: `PLC write failed: ${category}` };
  }

  router.post('/', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (!isPlainObject(req.body) || Object.keys(req.body).some((k) => k !== 'value')) {
      return res.status(400).json({ error: 'Request body must be { "value": number or boolean }' });
    }
    const variable = await variableRepo.findById(id);
    if (!variable) return res.status(404).json({ error: 'Variable not found' });
    if (!variable.writable) return res.status(409).json({ error: 'Variable is not writable' });
    if (!variable.enabled) return res.status(409).json({ error: 'Variable is disabled' });
    const plc = await plcRepo.findById(variable.plc_id);
    if (!plc || !plc.enabled) return res.status(409).json({ error: 'PLC is disabled' });

    // Valeur vérifiée avant de faire la queue derrière les lectures : un refus immédiat plutôt qu'après une attente.
    try {
      encodeValue(variable.data_type, req.body.value, variable.scale, variable.value_offset);
    } catch (err) {
      const { status, error } = failure(err);
      return res.status(status).json({ error });
    }

    try {
      const result = await poller.write(id, req.body.value);
      const written = roundValue(result.written, variable);
      const readBack = roundValue(result.readBack, variable);
      audit(req, variable, `${written} (read back: ${readBack === null ? 'unavailable' : readBack})`);
      res.json({ variable_id: id, written, read_back: readBack });
    } catch (err) {
      const { status, error } = failure(err);
      logger.warn(`PLC write by ${req.user.username} failed: variable ${id} (${error})`);
      res.status(status).json({ error });
    }
  }));

  return router;
}

module.exports = { createVariableWriteRouter };
