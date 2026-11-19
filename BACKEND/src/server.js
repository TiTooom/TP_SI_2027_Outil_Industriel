const { createApp } = require('./app');
const env = require('./config/env');
const poller = require('./jobs/pollerInstance');
const { closePools } = require('./db/pools');

// 0.0.0.0 : joignable depuis les autres conteneurs et le réseau local.
const server = createApp().listen(env.port, '0.0.0.0', () => {
  console.log(`Backend listening on 0.0.0.0:${env.port} (${env.nodeEnv})`);
});

// Le relevé démarre en tâche de fond : une BDD indisponible ne bloque pas l'API (nouvel essai périodique).
poller.start();

// Arrêt propre (docker stop envoie SIGTERM).
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    await poller.stop();
    await closePools();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
