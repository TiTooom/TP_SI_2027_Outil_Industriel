// Instance unique du service de relevé, câblée sur la vraie base et le vrai client Modbus.
const env = require('../config/env');
const repository = require('../repositories/pollerRepository');
const { createModbusClient } = require('../services/modbusClient');
const { createPoller } = require('./poller');

module.exports = createPoller({
  repository,
  modbus: createModbusClient({ timeoutMs: env.modbusTimeoutMs }),
});
