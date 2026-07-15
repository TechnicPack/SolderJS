const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadConfig } = require('../../config');
const { createDatabase } = require('../../src/database');
const { assertIntegrationEnvironment, assertTestDatabase } = require('./support');

assertIntegrationEnvironment();

test('starts and remains ready when Redis is unavailable', async () => {
  const config = loadConfig({ ...process.env, REDIS_HOST: '127.0.0.1', REDIS_PORT: '1' });
  const database = createDatabase(config, () => {});

  try {
    await database.connect();
    await assertTestDatabase(database.pool);
    await database.healthCheck();
    assert.equal(database.cache.isReady, false);
  } finally {
    await database.shutdown();
  }
});
