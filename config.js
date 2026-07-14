const BOOLEAN_VALUES = new Map([
  ['1', true],
  ['true', true],
  ['yes', true],
  ['on', true],
  ['0', false],
  ['false', false],
  ['no', false],
  ['off', false],
]);

function parseBoolean(name, value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = BOOLEAN_VALUES.get(value.toLowerCase());
  if (parsed === undefined) {
    throw new Error(`${name} must be one of: ${Array.from(BOOLEAN_VALUES.keys()).join(', ')}`);
  }
  return parsed;
}

function parseInteger(name, value, fallback, { min, max }) {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseMirrorUrl(value) {
  const mirror = new URL(value || 'https://localhost/');
  if (!['http:', 'https:'].includes(mirror.protocol)) {
    throw new Error('MIRROR_URL must use http or https');
  }
  return mirror.href.endsWith('/') ? mirror.href : `${mirror.href}/`;
}

function parseTrustProxy(value) {
  if (value === undefined || value === '' || value === 'false' || value === '0') {
    return false;
  }

  const hops = Number(value);
  if (Number.isInteger(hops) && hops > 0) {
    return hops;
  }

  return value;
}

function loadConfig(env = process.env) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    logging: {
      enabled: parseBoolean('NODE_LOGGING', env.NODE_LOGGING, true),
      level: env.LOGGING_LEVEL || 'info',
    },
    web: {
      host: env.HOST || 'localhost',
      port: parseInteger('PORT', env.PORT, 3000, { min: 1, max: 65535 }),
      trustProxy: parseTrustProxy(env.TRUST_PROXY),
    },
    redis: {
      host: env.REDIS_HOST || 'localhost',
      port: parseInteger('REDIS_PORT', env.REDIS_PORT, 6379, { min: 1, max: 65535 }),
      password: env.REDIS_PASSWORD || undefined,
      connectTimeoutMillis: parseInteger('REDIS_CONNECT_TIMEOUT_MS', env.REDIS_CONNECT_TIMEOUT_MS, 5000, {
        min: 100,
        max: 60000,
      }),
    },
    url: {
      mirror: parseMirrorUrl(env.MIRROR_URL),
    },
    pg: {
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: parseInteger('PG_CONNECTION_TIMEOUT_MS', env.PG_CONNECTION_TIMEOUT_MS, 5000, {
        min: 1,
        max: 60000,
      }),
      queryTimeoutMillis: parseInteger('PG_QUERY_TIMEOUT_MS', env.PG_QUERY_TIMEOUT_MS, 10000, {
        min: 1,
        max: 300000,
      }),
      max: parseInteger('PG_POOL_MAX', env.PG_POOL_MAX, 20, { min: 1, max: 100 }),
    },
    rateLimit: {
      windowMs: parseInteger('RATE_LIMIT_WINDOW_MS', env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, {
        min: 1000,
        max: 24 * 60 * 60 * 1000,
      }),
      apiMax: parseInteger('RATE_LIMIT_MAX', env.RATE_LIMIT_MAX, 300, { min: 1, max: 100000 }),
      verifyMax: parseInteger('VERIFY_RATE_LIMIT_MAX', env.VERIFY_RATE_LIMIT_MAX, 30, { min: 1, max: 100000 }),
    },
  };
}

module.exports = { loadConfig };
