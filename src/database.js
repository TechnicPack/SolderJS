const pg = require('pg');
const redis = require('redis');

function createDatabase(config, log) {
  let hasConnected = false;
  const cache = redis.createClient({
    socket: {
      host: config.redis.host,
      port: config.redis.port,
      connectTimeout: config.redis.connectTimeoutMillis,
      reconnectStrategy(retries) {
        if (!hasConnected && retries >= config.redis.startupRetries) {
          return new Error(`Redis unavailable after ${retries + 1} connection attempts`);
        }
        return Math.min(50 * 2 ** retries, 3000);
      },
    },
    password: config.redis.password,
    disableOfflineQueue: true,
  });

  cache.on('ready', () => {
    hasConnected = true;
  });

  cache.on('error', (err) => {
    log('error', 'Redis', 'Redis client error', err);
  });

  const pool = new pg.Pool({
    connectionString: config.pg.connectionString,
    connectionTimeoutMillis: config.pg.connectionTimeoutMillis,
    query_timeout: config.pg.queryTimeoutMillis,
    max: config.pg.max,
  });

  pool.on('error', (err) => {
    log('error', 'Database', 'Idle PostgreSQL client error', err);
  });

  async function connect() {
    await Promise.all([cache.connect(), pool.query('SELECT 1')]);
  }

  async function healthCheck() {
    await Promise.all([cache.ping(), pool.query('SELECT 1')]);
  }

  async function shutdown() {
    const tasks = [pool.end()];
    if (cache.isOpen) {
      tasks.push(cache.close());
    }

    const results = await Promise.allSettled(tasks);
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to close database connections');
    }
  }

  return { pool, cache, connect, healthCheck, shutdown };
}

module.exports = { createDatabase };
