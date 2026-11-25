// Client Modbus TCP : lecture (FC1, FC2, FC3, FC4) et, pour les variables déclarées modifiables,
// écriture sur holding (FC6, FC16) et coil (FC5) uniquement.
// Une connexion par automate, rouverte automatiquement après une erreur.
const ModbusRTU = require('modbus-serial');
const { registerCount, decodeValue, encodeValue } = require('./modbusDecoder');

const READERS = {
  coil: 'readCoils',
  discrete: 'readDiscreteInputs',
  holding: 'readHoldingRegisters',
  input: 'readInputRegisters',
};

// Les registres input (FC4) et discrete (FC2) sont en lecture seule dans le protocole : jamais écrits ici.
const WRITABLE_TYPES = new Set(['holding', 'coil']);

// modbus-serial n'impose pas de délai de connexion : on le borne nous-mêmes.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms} ms`), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createModbusClient({ timeoutMs, ClientClass = ModbusRTU }) {
  const connections = new Map(); // plcId -> { key, client }

  function dispose(plcId) {
    const conn = connections.get(plcId);
    if (!conn) return;
    connections.delete(plcId);
    try {
      conn.client.close(() => {});
    } catch {
      // Socket déjà fermée : rien à faire.
    }
  }

  async function connect(plc) {
    const key = `${plc.host}:${plc.port}`;
    const existing = connections.get(plc.plc_id);
    if (existing && existing.key === key && existing.client.isOpen) return existing.client;
    dispose(plc.plc_id);

    const client = new ClientClass();
    // Sans écouteur, un événement 'error' d'une socket ferait tomber tout le processus.
    client.on('error', () => {});
    connections.set(plc.plc_id, { key, client });
    try {
      await withTimeout(client.connectTCP(plc.host, { port: plc.port }), timeoutMs, 'Connection');
      client.setTimeout(timeoutMs);
      return client;
    } catch (err) {
      dispose(plc.plc_id);
      throw err;
    }
  }

  // Exécute `action(client)` sur la connexion de l'automate.
  // Une erreur portant modbusCode est une réponse d'exception de l'automate : la socket reste saine.
  async function withClient(plc, action) {
    const client = await connect(plc);
    try {
      client.setID(plc.unit_id);
      return await action(client);
    } catch (err) {
      if (err.modbusCode !== undefined) throw err;
      // La connexion est peut-être corrompue : on repart d'une socket neuve au prochain tick.
      dispose(plc.plc_id);
      throw err;
    }
  }

  // target : une ligne de relevé (automate + variable : plc_id, host, port, unit_id, register_type, address...).
  // Rejette en cas d'échec ; une erreur portant modbusCode est une réponse d'exception de l'automate.
  function read(target) {
    return withClient(target, async (client) => {
      const method = READERS[target.register_type];
      if (!method) throw new Error(`Unsupported register type: ${target.register_type}`);
      const length = registerCount(target.data_type);
      const { data } = await withTimeout(client[method](target.address, length), timeoutMs, 'Read');
      return decodeValue(target.data_type, data, target.scale, target.value_offset);
    });
  }

  // Écrit `value` (valeur physique) et renvoie { value } : ce que l'automate contient après arrondi au pas de l'échelle.
  // La valeur est encodée avant toute connexion : une valeur invalide (code INVALID_VALUE) ne touche pas le réseau.
  async function write(target, value) {
    if (!WRITABLE_TYPES.has(target.register_type)) {
      throw new Error(`Register type ${target.register_type} is read-only`);
    }
    const encoded = encodeValue(target.data_type, value, target.scale, target.value_offset);
    await withClient(target, async (client) => {
      const { address } = target;
      if (target.register_type === 'coil') {
        await withTimeout(client.writeCoil(address, encoded.bit), timeoutMs, 'Write');
      } else if (encoded.registers.length === 1) {
        await withTimeout(client.writeRegister(address, encoded.registers[0]), timeoutMs, 'Write');
      } else {
        // 32 bits : une seule requête FC16, pour que les deux mots arrivent ensemble.
        await withTimeout(client.writeRegisters(address, encoded.registers), timeoutMs, 'Write');
      }
    });
    return { value: encoded.value };
  }

  function closeAll() {
    for (const plcId of [...connections.keys()]) dispose(plcId);
  }

  return { read, write, closeAll };
}

module.exports = { createModbusClient };
