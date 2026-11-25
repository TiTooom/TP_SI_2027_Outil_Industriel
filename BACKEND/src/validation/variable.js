const { str, int, num, bool, oneOf, collect, isPlainObject } = require('./common');

const REGISTER_TYPES = ['holding', 'input', 'coil', 'discrete'];
const DATA_TYPES = ['int16', 'uint16', 'int32', 'uint32', 'float32', 'bool'];
const WRITABLE_ERROR = 'writable is only allowed for holding and coil registers (input and discrete are read-only in Modbus)';

function validateVariable(body) {
  const result = collect(body, {
    plc_id: (b) => int(b, 'plc_id', { min: 1, max: 4294967295, required: true }),
    name: (b) => str(b, 'name', { min: 1, max: 100, required: true }),
    register_type: (b) => oneOf(b, 'register_type', REGISTER_TYPES),
    address: (b) => int(b, 'address', { min: 0, max: 65535, required: true }),
    data_type: (b) => oneOf(b, 'data_type', DATA_TYPES),
    scale: (b) => num(b, 'scale', { nonZero: true, fallback: 1 }),
    value_offset: (b) => num(b, 'value_offset', { fallback: 0 }),
    unit: (b) => str(b, 'unit', { max: 20, fallback: '' }),
    frequency_s: (b) => int(b, 'frequency_s', { min: 1, max: 86400, required: true }),
    enabled: (b) => bool(b, 'enabled', true),
    writable: (b) => bool(b, 'writable', false),
  });
  if (result.error) return result;
  const { register_type: reg, data_type: type } = result.value;
  const bitRegister = reg === 'coil' || reg === 'discrete';
  if (bitRegister && type !== 'bool') return { error: `data_type must be bool for ${reg} registers` };
  if (!bitRegister && type === 'bool') return { error: `data_type bool is not allowed for ${reg} registers` };
  // Modbus : input (FC4) et discrete (FC2) sont en lecture seule, un automate refuserait l'écriture.
  if (result.value.writable && (reg === 'input' || reg === 'discrete')) return { error: WRITABLE_ERROR };
  return result;
}

// PATCH (rôle technician) : uniquement l'exploitation, jamais la topologie.
function validateVariablePatch(body) {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const unknown = Object.keys(body).find((k) => k !== 'enabled' && k !== 'frequency_s');
  if (unknown) return { error: `Unknown field: ${unknown}` };
  if (body.enabled === undefined && body.frequency_s === undefined) return { error: 'enabled or frequency_s is required' };
  const value = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return { error: 'enabled must be a boolean' };
    value.enabled = body.enabled;
  }
  if (body.frequency_s !== undefined) {
    const r = int(body, 'frequency_s', { min: 1, max: 86400, required: true });
    if (r.error) return r;
    value.frequency_s = r.value;
  }
  return { value };
}

module.exports = { validateVariablePatch, validateVariable, REGISTER_TYPES, DATA_TYPES };
