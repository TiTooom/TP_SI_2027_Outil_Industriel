// Client Modbus TCP en lecture seule (FC1, FC2, FC3, FC4 uniquement).
// Une connexion par automate, rouverte automatiquement après une erreur.
const ModbusRTU = require('modbus-serial');
const { registerCount, decodeValue } = require('./modbusDecoder');

const READERS = {
  coil: 'readCoils',
  discrete: 'readDiscreteInputs',
  holding: 'readHoldingRegisters',
  input: 'readInputRegisters',
};

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

  // target : une ligne de relevé (automate + variable : plc_id, host, port, unit_id, register_type, address...).
  // Rejette en cas d'échec ; une erreur portant modbusCode est une réponse d'exception de l'automate.
  async function read(target) {
    const plc = target;
    const variable = target;
    const client = await connect(plc);
    try {
      client.setID(plc.unit_id);
      const method = READERS[variable.register_type];
      if (!method) throw new Error(`Unsupported register type: ${variable.register_type}`);
      const length = registerCount(variable.data_type);
      const { data } = await withTimeout(client[method](variable.address, length), timeoutMs, 'Read');
      return decodeValue(variable.data_type, data, variable.scale, variable.value_offset);
    } catch (err) {
      // Une exception Modbus (adresse illégale...) prouve que l'automate répond et que la socket est saine.
      if (err.modbusCode !== undefined) throw err;
      // La connexion est peut-être corrompue : on repart d'une socket neuve au prochain tick.
      dispose(plc.plc_id);
      throw err;
    }
  }

  function closeAll() {
    for (const plcId of [...connections.keys()]) dispose(plcId);
  }

  return { read, closeAll };
}

module.exports = { createModbusClient };
