const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const { loadConfig } = require('../../config');
const { createData } = require('../../src/data');
const { createDatabase } = require('../../src/database');
const { assertIntegrationEnvironment, assertTestDatabase, createNamespacedCache } = require('./support');

assertIntegrationEnvironment();

describe('data layer integration', () => {
  let database;
  let data;
  let namespacedCache;
  const seed = {};

  before(async () => {
    const config = loadConfig(process.env);
    database = createDatabase(config, () => {});
    await database.connect();
    await database.connectCache();
    await assertTestDatabase(database.pool);
    namespacedCache = createNamespacedCache(database.cache);
    data = createData({ pool: database.pool, cache: namespacedCache.cache, log() {} });
    await seedDatabase(database.pool, seed);
  });

  beforeEach(async () => {
    await namespacedCache.clear();
  });

  after(async () => {
    if (namespacedCache) {
      await namespacedCache.clear();
    }
    if (database) {
      await database.shutdown();
    }
  });

  it('reads key and client authorization data', async () => {
    assert.equal((await data.getKey(seed.apiKey)).name, 'Integration Key');
    assert.equal((await data.verifyKey(seed.apiKey)).name, 'Integration Key');
    assert.deepEqual(await data.getClientAccess(seed.clientId), [seed.privateModpackId]);
    assert.equal(await data.getClientAccess('unknown-client'), null);
  });

  it('reads and caches modpacks', async () => {
    const modpacks = await data.getModpacks();
    assert.equal(modpacks.length, 2);
    assert.equal(modpacks.find((modpack) => modpack.slug === 'integration-public').private, false);

    await database.pool.query('DELETE FROM modpacks WHERE slug=$1', ['integration-public']);
    assert.equal((await data.getModpacks()).length, 2);
  });

  it('reads a modpack and its builds using the real schema', async () => {
    const modpack = await data.getModpack('integration-private');
    const builds = await data.getBuilds(modpack);
    const build = await data.getBuild(modpack, '1.0.0');

    assert.equal(modpack.id, seed.privateModpackId);
    assert.equal(builds.length, 1);
    assert.equal(build.id, seed.buildId);
    assert.equal(build.is_published, true);
    assert.equal(Object.hasOwn(build, 'hidden'), false);
  });

  it('joins mods and modversions', async () => {
    const mods = await data.getMods({ id: seed.buildId });

    assert.deepEqual(mods, [
      {
        id: seed.modId,
        name: 'integration-mod',
        pretty_name: 'Integration Mod',
        author: 'Author',
        description: 'Description',
        link: 'https://example.com',
        version: '1.0.0',
        md5: 'abc123',
        filesize: 1024,
      },
    ]);
  });
});

async function seedDatabase(pool, seed) {
  await pool.query(
    'TRUNCATE TABLE build_modversion, client_modpack, modversions, builds, mods, clients, keys, modpacks RESTART IDENTITY CASCADE',
  );

  const publicModpack = await pool.query(
    'INSERT INTO modpacks (name, slug, recommended, latest, hidden, private) VALUES ($1, $2, $3, $4, false, false) RETURNING id',
    ['Integration Public', 'integration-public', '1.0.0', '1.0.0'],
  );
  seed.publicModpackId = publicModpack.rows[0].id;

  const privateModpack = await pool.query(
    'INSERT INTO modpacks (name, slug, recommended, latest, hidden, private) VALUES ($1, $2, $3, $4, false, true) RETURNING id',
    ['Integration Private', 'integration-private', '1.0.0', '1.0.0'],
  );
  seed.privateModpackId = privateModpack.rows[0].id;

  const build = await pool.query(
    'INSERT INTO builds (modpack_id, version, minecraft, min_java, min_memory, is_published, private) VALUES ($1, $2, $3, $4, $5, true, false) RETURNING id',
    [seed.privateModpackId, '1.0.0', '1.20', '17', 2048],
  );
  seed.buildId = build.rows[0].id;

  const mod = await pool.query(
    'INSERT INTO mods (name, pretty_name, author, description, link) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    ['integration-mod', 'Integration Mod', 'Author', 'Description', 'https://example.com'],
  );
  seed.modId = mod.rows[0].id;

  const modversion = await pool.query(
    'INSERT INTO modversions (mod_id, version, md5, filesize) VALUES ($1, $2, $3, $4) RETURNING id',
    [seed.modId, '1.0.0', 'abc123', 1024],
  );
  await pool.query('INSERT INTO build_modversion (build_id, modversion_id) VALUES ($1, $2)', [
    seed.buildId,
    modversion.rows[0].id,
  ]);

  const client = await pool.query('INSERT INTO clients (name, uuid) VALUES ($1, $2) RETURNING id', [
    'Integration Client',
    'integration-client',
  ]);
  seed.clientId = 'integration-client';
  await pool.query('INSERT INTO client_modpack (client_id, modpack_id) VALUES ($1, $2)', [
    client.rows[0].id,
    seed.privateModpackId,
  ]);

  seed.apiKey = 'integration-api-key';
  await pool.query('INSERT INTO keys (name, api_key, created_at) VALUES ($1, $2, NOW())', [
    'Integration Key',
    seed.apiKey,
  ]);
}
