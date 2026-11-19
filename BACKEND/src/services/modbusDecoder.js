// Décodage pur des registres Modbus (sans I/O) : facile à tester.
// Types 32 bits : 2 registres, mot de poids fort en premier (« ABCD », big-endian).

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

module.exports = { registerCount, decodeRaw, decodeValue };
