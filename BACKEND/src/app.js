// Construction de l'application Express, séparée du démarrage pour pouvoir la tester.
const express = require('express');
const env = require('./config/env');
const healthRouter = require('./routes/health');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// CORS uniquement si une origine est explicitement autorisée (sinon même origine via nginx).
if (env.corsOrigin) {
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', env.corsOrigin);
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use('/api/health', healthRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

// Gestionnaire d'erreurs final : pas de pile d'appel renvoyée au client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
