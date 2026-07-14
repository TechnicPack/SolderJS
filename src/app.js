const express = require('express');
const { createAuthMiddleware } = require('./auth');
const { createRouter } = require('./routes');

function createApp({ config, data, log, healthCheck, version }) {
  const app = express();

  app.set('trust proxy', config.web.trustProxy);
  app.disable('x-powered-by');

  app.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/health/ready', async (_req, res) => {
    try {
      await healthCheck();
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      log('warn', 'Health', 'Readiness check failed', err);
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use(createAuthMiddleware({ data, log }));
  app.use(createRouter({ data, config, version }));

  app.use((_req, res) => {
    res.sendStatus(404);
  });

  app.use((err, _req, res, next) => {
    log('error', 'Server', 'Uncaught request error', err);
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({ error: 'An unexpected error has occurred' });
  });

  return app;
}

module.exports = { createApp };
