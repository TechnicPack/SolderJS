const pg = require('pg');
const redis = require('redis');

function createDatabase(config, log) {
  let cacheConnection;
  const cache = redis.createClient({
    socket: {
      host: config.redis.host,
      port: config.redis.port,
      connectTimeout: config.redis.connectTimeoutMillis,
      reconnectStrategy: (retries) => Math.min(50 * 2 ** retries, 3000),
    },
    password: config.redis.password,
    disableOfflineQueue: true,
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

  function connectCache() {
    if (!cacheConnection) {
      cacheConnection = cache.connect().catch((err) => {
        log('error', 'Redis', 'Redis connection stopped', err);
      });
    }
    return cacheConnection;
  }

  async function connect() {
    void connectCache();
    await pool.query('SELECT 1');
  }

  async function healthCheck() {
    await pool.query('SELECT 1');
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

  return { pool, cache, connect, connectCache, healthCheck, shutdown };
}

module.exports = { createDatabase };
