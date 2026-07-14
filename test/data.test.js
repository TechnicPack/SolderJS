const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createData } = require('../src/data');

function harness(rows = []) {
  const store = new Map();
  const queryCalls = [];
  const setCalls = [];
  const logs = [];
  let resultRows = rows;
  let getError;
  let setError;

  const pool = {
    async query(sql, params) {
      queryCalls.push({ sql, params });
      return { rows: resultRows };
    },
  };
  const cache = {
    async get(key) {
      if (getError) {
        throw getError;
      }
      return store.get(key) ?? null;
    },
    async set(key, value, options) {
      if (setError) {
        throw setError;
      }
      setCalls.push({ key, value, options });
      store.set(key, value);
    },
  };

  return {
    data: createData({ pool, cache, log: (...args) => logs.push(args) }),
    store,
    queryCalls,
    setCalls,
    logs,
    setRows(value) {
      resultRows = value;
    },
    failReads(error) {
      getError = error;
    },
    failWrites(error) {
      setError = error;
    },
  };
}

describe('authentication data', () => {
  it('looks up and caches key metadata without exposing the key in the cache key', async () => {
    const keyInfo = { name: 'Test Key', created_at: '2026-01-01' };
    const context = harness([keyInfo]);

    assert.deepEqual(await context.data.getKey('very-secret-api-key'), keyInfo);
    assert.equal(context.queryCalls.length, 1);
    assert.equal(context.queryCalls[0].sql, 'SELECT name, created_at FROM keys WHERE api_key=$1 LIMIT 1');
    assert.deepEqual(context.queryCalls[0].params, ['very-secret-api-key']);
    assert.equal(context.setCalls[0].options.EX, 60);
    assert.doesNotMatch(context.setCalls[0].key, /very-secret-api-key/);
  });

  it('negatively caches unknown keys', async () => {
    const context = harness([]);

    assert.equal(await context.data.getKey('unknown'), null);
    assert.equal(await context.data.getKey('unknown'), null);
    assert.equal(context.queryCalls.length, 1);
  });

  it('bypasses the authentication cache when explicitly verifying a key', async () => {
    const context = harness([]);

    assert.equal(await context.data.getKey('new-key'), null);
    context.setRows([{ name: 'New Key', created_at: '2026-01-01' }]);

    assert.deepEqual(await context.data.verifyKey('new-key'), { name: 'New Key', created_at: '2026-01-01' });
    assert.equal(context.queryCalls.length, 2);
  });

  it('distinguishes unknown clients from valid clients with no modpack assignments', async () => {
    const context = harness([]);

    assert.equal(await context.data.getClientAccess('unknown'), null);

    context.setRows([{ id: 5, modpack_id: null }]);
    assert.deepEqual(await context.data.getClientAccess('known'), []);
    assert.match(context.queryCalls[1].sql, /LEFT JOIN client_modpack/);
  });

  it('returns all assigned modpack IDs for a client without caching authorization', async () => {
    const context = harness([
      { id: 5, modpack_id: 3 },
      { id: 5, modpack_id: 7 },
    ]);

    assert.deepEqual(await context.data.getClientAccess('client-id'), [3, 7]);

    context.setRows([{ id: 5, modpack_id: null }]);
    assert.deepEqual(await context.data.getClientAccess('client-id'), []);
    assert.equal(context.queryCalls.length, 2);
    assert.equal(context.setCalls.length, 0);
  });
});

describe('content data', () => {
  it('caches modpack lists for five minutes and avoids SELECT *', async () => {
    const rows = [{ id: 1, slug: 'pack' }];
    const context = harness(rows);

    assert.deepEqual(await context.data.getModpacks(), rows);
    assert.deepEqual(await context.data.getModpacks(), rows);
    assert.equal(context.queryCalls.length, 1);
    assert.doesNotMatch(context.queryCalls[0].sql, /SELECT \*/);
    assert.deepEqual(context.setCalls[0].options, { EX: 300 });
  });

  it('coalesces concurrent cache misses', async () => {
    const context = harness([{ id: 1, slug: 'pack' }]);

    await Promise.all([context.data.getModpacks(), context.data.getModpacks(), context.data.getModpacks()]);

    assert.equal(context.queryCalls.length, 1);
    assert.equal(context.setCalls.length, 1);
  });

  it('queries a modpack by slug with explicit columns', async () => {
    const row = { id: 1, slug: 'pack' };
    const context = harness([row]);

    assert.deepEqual(await context.data.getModpack('pack'), row);
    assert.deepEqual(context.queryCalls[0].params, ['pack']);
    for (const column of ['id', 'slug', 'name', 'recommended', 'latest', 'hidden', 'private']) {
      assert.match(context.queryCalls[0].sql, new RegExp(`\\b${column}\\b`));
    }
  });

  it('queries builds with only columns present in the Solder schema', async () => {
    const context = harness([]);

    await context.data.getBuilds({ id: 4 });
    const { sql, params } = context.queryCalls[0];

    assert.deepEqual(params, [4]);
    assert.doesNotMatch(sql, /SELECT \*/);
    assert.doesNotMatch(sql, /\bhidden\b/);
    for (const column of ['minecraft', 'forge', 'min_java', 'min_memory', 'private', 'is_published']) {
      assert.match(sql, new RegExp(`\\b${column}\\b`));
    }
  });

  it('queries a build by modpack and version', async () => {
    const row = { id: 8, version: '1.0.0' };
    const context = harness([row]);

    assert.deepEqual(await context.data.getBuild({ id: 4 }, '1.0.0'), row);
    assert.deepEqual(context.queryCalls[0].params, [4, '1.0.0']);
  });

  it('uses an explicit mod join projection', async () => {
    const context = harness([]);

    await context.data.getMods({ id: 9 });
    const { sql, params } = context.queryCalls[0];

    assert.deepEqual(params, [9]);
    assert.doesNotMatch(sql, /\*/);
    for (const column of ['mods.name', 'mods.pretty_name', 'mv.version', 'mv.md5', 'mv.filesize']) {
      assert.match(sql, new RegExp(column.replace('.', '\\.')));
    }
  });
});

describe('cache resilience', () => {
  it('falls back to PostgreSQL when cache reads fail', async () => {
    const rows = [{ id: 1, slug: 'pack' }];
    const context = harness(rows);
    context.failReads(new Error('Redis unavailable'));

    assert.deepEqual(await context.data.getModpacks(), rows);
    assert.equal(context.queryCalls.length, 1);
    assert.equal(context.logs[0][0], 'warn');
  });

  it('returns PostgreSQL results when cache writes fail', async () => {
    const rows = [{ id: 1, slug: 'pack' }];
    const context = harness(rows);
    context.failWrites(new Error('Redis unavailable'));

    assert.deepEqual(await context.data.getModpacks(), rows);
    assert.equal(context.logs[0][0], 'warn');
  });

  it('recovers from malformed cached JSON', async () => {
    const rows = [{ id: 1, slug: 'pack' }];
    const context = harness(rows);
    context.store.set('api:modpacks', '{broken');

    assert.deepEqual(await context.data.getModpacks(), rows);
    assert.equal(context.queryCalls.length, 1);
  });
});
