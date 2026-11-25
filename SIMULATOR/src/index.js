// Serveur Modbus TCP factice : mêmes IP/port configurables qu'un vrai automate.
const { ServerTCP } = require('modbus-serial');
const { SIGNALS, SETPOINTS, COIL_COUNT, REGISTER_COUNT, rawValue } = require('./signals');
const { createVector, UNIT_ID } = require('./vector');

const port = Number(process.env.SIM_PORT || 5020);
const registers = new Array(REGISTER_COUNT).fill(0);
for (const sp of SETPOINTS) registers[sp.address] = sp.initial;
const coils = new Array(COIL_COUNT).fill(false);

// Ne recalcule que les mesures : les consignes écrites par l'application restent intactes.
function refresh() {
  const t = Date.now() / 1000;
  for (const s of SIGNALS) registers[s.address] = rawValue(s, t, Math.random() * 2 - 1);
}
refresh();
const ticker = setInterval(refresh, 1000);

const vector = createVector(registers, { writable: new Set(SETPOINTS.map((sp) => sp.address)), coils });

const server = new ServerTCP(vector, { host: '0.0.0.0', port, unitID: UNIT_ID });
server.on('socketError', () => {});
server.on('error', (err) => {
  console.error(`Simulator error: ${err.message}`);
  process.exit(1);
});
server.on('initialized', () => console.log(`Modbus simulator listening on 0.0.0.0:${port} (unit ${UNIT_ID})`));

function shutdown() {
  clearInterval(ticker);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
