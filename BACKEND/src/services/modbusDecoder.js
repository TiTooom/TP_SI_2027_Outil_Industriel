// Décodage et encodage purs des registres Modbus (sans I/O) : faciles à tester.
// Types 32 bits : 2 registres, mot de poids fort en premier (« ABCD », big-endian).
const { roundValue } = require('./roundValue');

const REGISTER_COUNT = { int16: 1, uint16: 1, int32: 2, uint32: 2, float32: 2, bool: 1 };

function registerCount(dataType) {
  const n = REGISTER_COUNT[dataType];
  if (!n) throw new Error(`Unsupported data type: ${dataType}`);
  return n;
}

// raw : tableau de registres 16 bits non signés (ou de booléens pour coil/discrete).
function decodeRaw(dataType, raw) {
  const needed = registerCount(dataType);
  if (!Array.isArray(raw) || raw.length < needed) throw new Error('Not enough data returned by the device');
  if (dataType === 'bool') return raw[0] ? 1 : 0;
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(raw[0], 0);
  if (needed === 2) buf.writeUInt16BE(raw[1], 2);
  switch (dataType) {
    case 'int16': return buf.readInt16BE(0);
    case 'uint16': return buf.readUInt16BE(0);
    case 'int32': return buf.readInt32BE(0);
    case 'uint32': return buf.readUInt32BE(0);
    default: return buf.readFloatBE(0);
  }
}

// valeur physique = brut × scale + value_offset ; une valeur non finie (NaN d'un float32) est un échec.
function decodeValue(dataType, raw, scale = 1, offset = 0) {
  const value = decodeRaw(dataType, raw) * scale + offset;
  if (!Number.isFinite(value)) throw new Error('Decoded value is not a finite number');
  return value;
}

// --- Encodage (écriture vers l'automate) ---------------------------------------------------

const RAW_RANGES = {
  int16: [-32768, 32767],
  uint16: [0, 65535],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-3.4028234663852886e38, 3.4028234663852886e38],
};

// Erreur de valeur (et non de réseau) : le routeur la transforme en 400, sans jamais ouvrir de connexion.
function invalidValue(message) {
  return Object.assign(new Error(message), { code: 'INVALID_VALUE' });
}

// Bornes physiques acceptées pour un type : le brut est borné, scale peut être négatif d'où le tri.
function physicalRange(dataType, scale, offset) {
  const variable = { data_type: dataType, scale, value_offset: offset };
  const [lo, hi] = RAW_RANGES[dataType].map((raw) => raw * scale + offset).sort((a, b) => a - b);
  return { min: roundValue(lo, variable), max: roundValue(hi, variable) };
}

// Inverse de decodeValue : valeur physique -> registres 16 bits (mot de poids fort en premier) ou bit pour un coil.
// Renvoie aussi `value`, la valeur physique réellement représentée après arrondi au pas de l'échelle.
function encodeValue(dataType, value, scale = 1, offset = 0) {
  if (dataType === 'bool') {
    if (value !== true && value !== false && value !== 0 && value !== 1) {
      throw invalidValue('A boolean value (true, false, 0 or 1) is required');
    }
    const bit = value === true || value === 1;
    return { bit, value: bit ? 1 : 0 };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidValue('A finite number is required');
  const raw = (value - offset) / scale;
  const [min, max] = RAW_RANGES[dataType] || [];
  if (min === undefined) throw new Error(`Unsupported data type: ${dataType}`);
  const stored = dataType === 'float32' ? raw : Math.round(raw);
  if (!(stored >= min && stored <= max)) {
    const range = physicalRange(dataType, scale, offset);
    throw invalidValue(`Value out of range: must be between ${range.min} and ${range.max}`);
  }
  const buf = Buffer.alloc(4);
  switch (dataType) {
    case 'int16': buf.writeInt16BE(stored, 0); break;
    case 'uint16': buf.writeUInt16BE(stored, 0); break;
    case 'int32': buf.writeInt32BE(stored, 0); break;
    case 'uint32': buf.writeUInt32BE(stored, 0); break;
    default: buf.writeFloatBE(stored, 0);
  }
  const registers = [buf.readUInt16BE(0)];
  if (registerCount(dataType) === 2) registers.push(buf.readUInt16BE(2));
  return { registers, value: decodeValue(dataType, registers, scale, offset) };
}

module.exports = { registerCount, decodeRaw, decodeValue, encodeValue };
