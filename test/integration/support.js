const { randomUUID } = require('node:crypto');

const TEST_DATABASE_MARKER = 'solderjs-integration-v1';

function assertIntegrationEnvironment(env = process.env) {
  if (env.SOLDERJS_ALLOW_DESTRUCTIVE_TESTS !== '1') {
    throw new Error(
      'Integration tests are destructive; set SOLDERJS_ALLOW_DESTRUCTIVE_TESTS=1 and use the dedicated test services',
    );
  }

  const missing = ['DATABASE_URL', 'REDIS_HOST'].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Integration tests require: ${missing.join(', ')}`);
  }
}

async function assertTestDatabase(pool) {
  try {
    const result = await pool.query('SELECT marker FROM solderjs_test_guard WHERE marker=$1', [TEST_DATABASE_MARKER]);
    if (result.rows.length !== 1) {
      throw new Error('test database marker does not match');
    }
  } catch (err) {
    throw new Error('Refusing to modify a database without the SolderJS integration-test marker', { cause: err });
  }
}

function createNamespacedCache(cache, namespace = `solderjs:test:${randomUUID()}:`) {
  const writtenKeys = new Set();

  return {
    cache: {
      get(key) {
        return cache.get(`${namespace}${key}`);
      },
      set(key, value, options) {
        const namespacedKey = `${namespace}${key}`;
        writtenKeys.add(namespacedKey);
        return cache.set(namespacedKey, value, options);
      },
    },
    async clear() {
      if (writtenKeys.size === 0) {
        return;
      }
      await cache.del(Array.from(writtenKeys));
      writtenKeys.clear();
    },
  };
}

module.exports = {
  TEST_DATABASE_MARKER,
  assertIntegrationEnvironment,
  assertTestDatabase,
  createNamespacedCache,
};
