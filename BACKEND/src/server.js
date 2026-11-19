const app = require('./app');
const env = require('./config/env');
const { closePools } = require('./db/pools');

// 0.0.0.0 : joignable depuis les autres conteneurs et le réseau local.
const server = app.listen(env.port, '0.0.0.0', () => {
  console.log(`Backend listening on 0.0.0.0:${env.port} (${env.nodeEnv})`);
});

// Arrêt propre (docker stop envoie SIGTERM).
async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await closePools();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
