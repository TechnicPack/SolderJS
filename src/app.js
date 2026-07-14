const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createAuthMiddleware } = require('./auth');
const { createRouter } = require('./routes');

function createApp({ config, data, log, healthCheck, version }) {
  const app = express();

  try {
    app.set('trust proxy', config.web.trustProxy);
  } catch (err) {
    throw new Error(`Invalid TRUST_PROXY setting: ${err.message}`, { cause: err });
  }
  app.disable('x-powered-by');

  app.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const checkReadiness = cacheCheck(healthCheck, 1000);
  app.get('/health/ready', async (_req, res) => {
    try {
      await checkReadiness();
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      log('warn', 'Health', 'Readiness check failed', err);
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const limiterOptions = {
    windowMs: config.rateLimit.windowMs,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  };
  const apiLimiter = rateLimit({ ...limiterOptions, limit: config.rateLimit.apiMax });
  const verifyLimiter = rateLimit({ ...limiterOptions, limit: config.rateLimit.verifyMax });

  app.use('/api', apiLimiter);
  app.use('/api', createAuthMiddleware({ data, log }));
  app.use(createRouter({ data, config, version, verifyLimiter }));

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

function cacheCheck(check, ttlMillis) {
  let current;
  let settled = false;
  let settledAt = 0;

  return function checkOnce() {
    if (!current || (settled && Date.now() - settledAt >= ttlMillis)) {
      settled = false;
      current = Promise.resolve().then(check);
      current.then(
        () => {
          settled = true;
          settledAt = Date.now();
        },
        () => {
          settled = true;
          settledAt = Date.now();
        },
      );
    }
    return current;
  };
}

module.exports = { createApp };
