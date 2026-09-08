const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  TEST_DATABASE_MARKER,
  assertIntegrationEnvironment,
  assertTestDatabase,
  createNamespacedCache,
} = require('./integration/support');

describe('integration test safeguards', () => {
  it('requires an explicit destructive-test opt-in and service configuration', () => {
    assert.throws(() => assertIntegrationEnvironment({}), /Integration tests are destructive/);
    assert.throws(
      () => assertIntegrationEnvironment({ SOLDERJS_ALLOW_DESTRUCTIVE_TESTS: '1' }),
      /DATABASE_URL, REDIS_HOST/,
    );
    assert.doesNotThrow(() =>
      assertIntegrationEnvironment({
        SOLDERJS_ALLOW_DESTRUCTIVE_TESTS: '1',
        DATABASE_URL: 'postgres://localhost/test',
        REDIS_HOST: 'localhost',
      }),
    );
  });

  it('refuses databases without the integration-test marker', async () => {
    await assert.rejects(
      assertTestDatabase({ query: async () => ({ rows: [] }) }),
      /Refusing to modify a database without the SolderJS integration-test marker/,
    );

    await assert.doesNotReject(
      assertTestDatabase({ query: async () => ({ rows: [{ marker: TEST_DATABASE_MARKER }] }) }),
    );
  });

  it('isolates cache writes and cleanup under a per-run namespace', async () => {
    const store = new Map([['unrelated', 'keep-me']]);
    const cache = {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => store.set(key, value),
      unlink: async (keys) => {
        for (const key of keys) {
          store.delete(key);
        }
      },
    };
    const namespaced = createNamespacedCache(cache, 'test-run:');

    await namespaced.cache.set('api:modpacks', '[]');
    assert.equal(await namespaced.cache.get('api:modpacks'), '[]');
    assert.equal(store.get('test-run:api:modpacks'), '[]');

    await namespaced.clear();
    assert.equal(store.has('test-run:api:modpacks'), false);
    assert.equal(store.get('unrelated'), 'keep-me');
  });
});
