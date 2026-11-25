// Validation client alignée sur les règles du contrat J2 (le serveur reste l'autorité).
// Chaque validateur renvoie { errors: { champ: message }, value } ; value est null si erreurs.

const HOSTNAME_RE = /^(?=.{1,255}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const REGISTER_TYPES = ['holding', 'input', 'coil', 'discrete'];
const DATA_TYPES = ['int16', 'uint16', 'int32', 'uint32', 'float32', 'bool'];

export function isValidHost(host) {
  const m = IPV4_RE.exec(host);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);
  // Un nom 100 % numérique/pointé qui n'est pas une IPv4 valide est refusé
  return !/^[\d.]+$/.test(host) && HOSTNAME_RE.test(host);
}

function intIn(raw, min, max, label, errors, key) {
  const text = String(raw).trim();
  if (!/^-?\d+$/.test(text)) { errors[key] = `${label} : entier requis.`; return null; }
  const n = Number(text);
  if (n < min || n > max) { errors[key] = `${label} : entre ${min} et ${max}.`; return null; }
  return n;
}

function finiteNumber(raw, label, errors, key) {
  const text = String(raw).trim();
  const n = Number(text);
  if (text === '' || !Number.isFinite(n)) { errors[key] = `${label} : nombre requis.`; return null; }
  return n;
}

function name(raw, errors) {
  const v = String(raw).trim();
  if (!v) errors.name = 'Le nom est obligatoire.';
  else if (v.length > 100) errors.name = '100 caractères maximum.';
  return v;
}

export function validatePlc(f) {
  const errors = {};
  const nameValue = name(f.name, errors);
  const host = String(f.host).trim();
  if (!host) errors.host = "L'hôte est obligatoire.";
  else if (!isValidHost(host)) errors.host = 'Adresse IPv4 (ex. 192.168.1.10) ou nom DNS valide attendu.';
  const port = intIn(f.port, 1, 65535, 'Port', errors, 'port');
  const unitId = intIn(f.unit_id, 0, 255, 'Unit ID', errors, 'unit_id');
  if (Object.keys(errors).length) return { errors, value: null };
  return { errors, value: { name: nameValue, host, port, unit_id: unitId, enabled: Boolean(f.enabled) } };
}

export function validateVariable(f) {
  const errors = {};
  const nameValue = name(f.name, errors);
  const plcId = Number(f.plc_id);
  if (!Number.isInteger(plcId) || plcId < 1) errors.plc_id = 'Choisissez un automate.';
  if (!REGISTER_TYPES.includes(f.register_type)) errors.register_type = 'Type de registre invalide.';
  if (!DATA_TYPES.includes(f.data_type)) errors.data_type = 'Type de donnée invalide.';
  const bitRegister = f.register_type === 'coil' || f.register_type === 'discrete';
  if (bitRegister && f.data_type !== 'bool') errors.data_type = 'coil et discrete imposent le type bool.';
  if (!bitRegister && f.data_type === 'bool') errors.data_type = 'holding et input n’acceptent pas bool.';
  // Modbus : input (FC4) et discrete (FC2) sont en lecture seule, un automate refuserait l'écriture.
  if (f.writable && (f.register_type === 'input' || f.register_type === 'discrete')) {
    errors.writable = 'Seuls holding et coil peuvent être modifiés.';
  }
  const address = intIn(f.address, 0, 65535, 'Adresse', errors, 'address');
  const scale = finiteNumber(f.scale, 'Échelle', errors, 'scale');
  if (scale === 0) errors.scale = 'L’échelle ne peut pas être 0.';
  const offset = finiteNumber(f.value_offset, 'Décalage', errors, 'value_offset');
  const unit = String(f.unit).trim();
  if (unit.length > 20) errors.unit = '20 caractères maximum.';
  const freq = intIn(f.frequency_s, 1, 86400, 'Fréquence', errors, 'frequency_s');
  if (Object.keys(errors).length) return { errors, value: null };
  return {
    errors,
    value: {
      plc_id: plcId, name: nameValue, register_type: f.register_type, address, data_type: f.data_type,
      scale, value_offset: offset, unit, frequency_s: freq, enabled: Boolean(f.enabled), writable: Boolean(f.writable),
    },
  };
}
