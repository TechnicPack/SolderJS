const { hasControlCharacters } = require('./validation');

function createAuthMiddleware({ data, log }) {
  return async function authMiddleware(req, res, next) {
    const key = credential(req, 'k');
    const clientId = credential(req, 'cid');

    res.locals.client = { authed: false, modpacks: [] };
    res.locals.key = { authed: false };

    try {
      const [keyInfo, clientAccess] = await Promise.all([
        key ? data.getKey(key) : null,
        clientId ? data.getClientAccess(clientId) : null,
      ]);

      if (keyInfo) {
        res.locals.key.authed = true;
        log('info', 'Auth', `Authenticated API key: ${maskCredential(key)}`);
      }

      if (clientAccess) {
        res.locals.client = { authed: true, modpacks: clientAccess };
        log('info', 'Auth', `Authenticated client ID: ${maskCredential(clientId)}`);
      }
    } catch (err) {
      log('error', 'Auth', 'Authentication service unavailable', err);
      res.status(503).json({ error: 'Service temporarily unavailable' });
      return;
    }

    next();
  };
}

function credential(req, query) {
  const value = req.query[query];
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || hasControlCharacters(value)) {
    return null;
  }
  return value;
}

function maskCredential(value) {
  if (value.length <= 8) {
    return '***';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

module.exports = { createAuthMiddleware, maskCredential };
