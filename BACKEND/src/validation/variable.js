const { str, int, num, bool, oneOf, collect } = require('./common');

const REGISTER_TYPES = ['holding', 'input', 'coil', 'discrete'];
const DATA_TYPES = ['int16', 'uint16', 'int32', 'uint32', 'float32', 'bool'];

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
  });
  if (result.error) return result;
  const { register_type: reg, data_type: type } = result.value;
  const bitRegister = reg === 'coil' || reg === 'discrete';
  if (bitRegister && type !== 'bool') return { error: `data_type must be bool for ${reg} registers` };
  if (!bitRegister && type === 'bool') return { error: `data_type bool is not allowed for ${reg} registers` };
  return result;
}

module.exports = { validateVariable, REGISTER_TYPES, DATA_TYPES };
