// Construction de l'application Express, séparée du démarrage pour pouvoir la tester.
const express = require('express');
const env = require('./config/env');
const healthRouter = require('./routes/health');
const { createPlcsRouter } = require('./routes/plcs');
const { createExportRouter } = require('./routes/export');
const { createVariablesRouter } = require('./routes/variables');
const { createVariableWriteRouter } = require('./routes/variableWrite');
const { createAuthRouter } = require('./routes/auth');
const { createUsersRouter } = require('./routes/users');
const { createTeamsRouter } = require('./routes/teams');
const { createDashboardsRouter } = require('./routes/dashboards');
const { createAuthenticate } = require('./middleware/authenticate');
const { requireRole, requireRoleByMethod } = require('./middleware/requireRole');
const { csrfGuard } = require('./middleware/csrf');
const { createLoginThrottle } = require('./services/loginThrottle');

// Les dépendances par défaut sont chargées à la demande : les tests injectent des mocks
// sans ouvrir de pool SQL.
function defaultDeps() {
  return {
    plcRepo: require('./repositories/plcRepository'),
    variableRepo: require('./repositories/variableRepository'),
    measureRepo: require('./repositories/measureRepository'),
    poller: require('./jobs/pollerInstance'),
    userRepo: require('./repositories/userRepository'),
    teamRepo: require('./repositories/teamRepository'),
    dashboardRepo: require('./repositories/dashboardRepository'),
    sessionService: require('./services/sessionInstance'),
    throttle: createLoginThrottle(),
  };
}

function createApp(deps = defaultDeps()) {
  const app = express();

  app.disable('x-powered-by');
  // Un seul proxy (nginx) : il écrase X-Forwarded-For. En accès direct sur le port 3000 publié,
  // l'en-tête peut être forgé ; le quota par nom d'utilisateur en limite l'impact.
  app.set('trust proxy', 1);
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(csrfGuard);
  app.use(express.json({ limit: '100kb' }));

  // CORS uniquement si une origine est explicitement autorisée (sinon même origine via nginx).
  if (env.corsOrigin) {
    app.use((req, res, next) => {
      res.set('Access-Control-Allow-Origin', env.corsOrigin);
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  app.use('/api/health', healthRouter);
  // Matrice des droits (voir le tableau des rôles du README) : tout sauf /health et /auth/login exige une session.
  const authenticate = createAuthenticate(deps.sessionService);
  const admin = [authenticate, requireRole('admin')];
  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api/plcs', authenticate, requireRoleByMethod({ GET: 'viewer' }, 'engineer'), createPlcsRouter(deps));
  // Envoyer une valeur à l'automate est un acte d'exploitation (technician), pas de configuration (engineer) :
  // route déclarée avant le routeur des variables, dont le POST exige engineer.
  app.use('/api/variables/:id/write', authenticate, requireRole('technician'), createVariableWriteRouter(deps));
  app.use('/api/variables', authenticate,
    requireRoleByMethod({ GET: 'viewer', PATCH: 'technician' }, 'engineer'), createVariablesRouter(deps));
  app.use('/api/export.csv', authenticate, requireRoleByMethod({ GET: 'viewer' }, 'engineer'), createExportRouter(deps));
  app.use('/api/users', ...admin, createUsersRouter(deps));
  app.use('/api/teams', ...admin, createTeamsRouter(deps));
  app.use('/api/dashboards', authenticate, createDashboardsRouter(deps));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

  // Gestionnaire d'erreurs final : pas de pile d'appel renvoyée au client.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    // Erreurs HTTP du parseur (413 corps trop gros...) : message sûr, prévu par la bibliothèque.
    if (err.status >= 400 && err.status < 500 && err.expose) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
