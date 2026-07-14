const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const request = require('supertest');
const { createApp } = require('../src/app');
const fixtures = require('./fixtures');

const allModpacks = Object.values(fixtures.modpacks);
const allBuilds = Object.values(fixtures.builds);

function createData(overrides = {}) {
  return {
    getKey: async (key) => (key === 'valid-key' ? { name: 'Test Key', created_at: '2026-01-01' } : null),
    getClientAccess: async (clientId) => {
      if (clientId === 'private-client') return [3];
      if (clientId === 'public-client') return [1];
      if (clientId === 'hidden-client') return [2];
      return null;
    },
    getModpacks: async () => allModpacks,
    getModpack: async (slug) => allModpacks.find((modpack) => modpack.slug === slug) || null,
    getBuilds: async (modpack) => allBuilds.filter((build) => build.modpack_id === modpack.id),
    getBuild: async (modpack, version) =>
      allBuilds.find((build) => build.modpack_id === modpack.id && build.version === version) || null,
    getMods: async () => fixtures.mods,
    ...overrides,
  };
}

function createTestApp({
  data = createData(),
  healthCheck = async () => {},
  logs = [],
  rateLimits = { apiMax: 1000, verifyMax: 1000 },
} = {}) {
  return createApp({
    config: {
      web: { trustProxy: false },
      url: { mirror: 'https://cdn.example.com/' },
      rateLimit: { windowMs: 60000, ...rateLimits },
    },
    data,
    healthCheck,
    log: (...args) => logs.push(args),
    version: 'test-version',
  });
}

describe('service endpoints', () => {
  it('provides liveness and readiness endpoints', async () => {
    const app = createTestApp();

    await request(app).get('/health/live').expect(200, { status: 'ok' });
    await request(app).get('/health/ready').expect(200, { status: 'ok' });
  });

  it('reports failed readiness checks without exposing details', async () => {
    const app = createTestApp({
      healthCheck: async () => {
        throw new Error('connection refused');
      },
    });

    await request(app).get('/health/ready').expect(503, { status: 'unavailable' });
  });

  it('redirects the root and reports the package version', async () => {
    const app = createTestApp();

    await request(app).get('/').expect(302).expect('location', '/api/');
    const response = await request(app).get('/api').expect(200);
    assert.deepEqual(response.body, { api: 'SolderJS', version: 'test-version', stream: 'stable' });
    assert.equal(response.headers['x-powered-by'], undefined);
  });
});

describe('modpack routes', () => {
  it('only lists public modpacks anonymously', async () => {
    const response = await request(createTestApp()).get('/api/modpack').expect(200);

    assert.deepEqual(response.body.modpacks, { 'public-pack': 'Public Pack' });
    assert.equal(response.body.mirror_url, 'https://cdn.example.com/');
  });

  it('lists all modpacks for a valid TechnicSolder API key parameter', async () => {
    const response = await request(createTestApp()).get('/api/modpack?k=valid-key').expect(200);

    assert.deepEqual(Object.keys(response.body.modpacks).sort(), ['hidden-pack', 'private-pack', 'public-pack']);
  });

  it('supports TechnicSolder client parameters', async () => {
    const privateResponse = await request(createTestApp()).get('/api/modpack?cid=private-client').expect(200);
    assert.equal(privateResponse.body.modpacks['private-pack'], 'Private Pack');

    const hiddenResponse = await request(createTestApp()).get('/api/modpack?cid=hidden-client').expect(200);
    assert.equal(hiddenResponse.body.modpacks['hidden-pack'], 'Hidden Pack');
  });

  it('builds full responses and omits inaccessible builds', async () => {
    const response = await request(createTestApp()).get('/api/modpack?include=full&k=valid-key').expect(200);

    assert.deepEqual(response.body.modpacks['public-pack'].builds, ['1.0.0', '2.0.0', 'private-1.0.0']);
    assert.equal(response.body.modpacks['public-pack'].builds.includes('3.0.0'), false);
  });

  it('allows direct access to hidden public modpacks', async () => {
    const response = await request(createTestApp()).get('/api/modpack/hidden-pack').expect(200);

    assert.equal(response.body.name, 'hidden-pack');
  });

  it('does not reveal private modpacks without access', async () => {
    await request(createTestApp()).get('/api/modpack/private-pack').expect(404);
    await request(createTestApp()).get('/api/modpack/private-pack?cid=private-client').expect(200);
  });

  it('rejects invalid and unknown modpack slugs', async () => {
    await request(createTestApp()).get('/api/modpack/not%20a%20slug').expect(404);
    await request(createTestApp()).get('/api/modpack/missing').expect(404);
  });
});

describe('build routes', () => {
  it('returns builds and optional mod metadata', async () => {
    const response = await request(createTestApp()).get('/api/modpack/public-pack/1.0.0?include=mods').expect(200);

    assert.equal(response.body.minecraft, '1.20');
    assert.equal(response.body.mods.length, 2);
    assert.equal(response.body.mods[0].pretty_name, 'Test Mod');
    assert.equal(response.body.mods[0].url, 'https://cdn.example.com/mods/test-mod/test-mod-1.0.zip');
    assert.equal(Object.hasOwn(response.body.mods[1], 'filesize'), false);
  });

  it('does not reveal unpublished or private builds without access', async () => {
    await request(createTestApp()).get('/api/modpack/public-pack/3.0.0').expect(404);
    await request(createTestApp()).get('/api/modpack/public-pack/private-1.0.0').expect(404);
  });

  it('allows private builds with modpack access', async () => {
    await request(createTestApp()).get('/api/modpack/public-pack/private-1.0.0?cid=public-client').expect(200);
  });

  it('enforces parent modpack privacy even when a child build is public', async () => {
    await request(createTestApp()).get('/api/modpack/private-pack/1.0.0').expect(404);
    await request(createTestApp()).get('/api/modpack/private-pack/1.0.0?cid=private-client').expect(200);
  });
});

describe('verification and error handling', () => {
  it('verifies keys without returning the key itself', async () => {
    const response = await request(createTestApp()).get('/api/verify/valid-key').expect(200);

    assert.deepEqual(response.body, { valid: true, name: 'Test Key', created_at: '2026-01-01' });
    await request(createTestApp()).get('/api/verify/invalid-key').expect(404);
  });

  it('converts rejected route promises into a 500 response', async () => {
    const data = createData({
      getModpacks: async () => {
        throw new Error('database failed');
      },
    });

    await request(createTestApp({ data })).get('/api/modpack').expect(500, {
      error: 'An unexpected error has occurred',
    });
  });

  it('returns 503 when credential validation storage is unavailable', async () => {
    const data = createData({
      getKey: async () => {
        throw new Error('database failed');
      },
    });

    await request(createTestApp({ data })).get('/api/modpack?k=key').expect(503, {
      error: 'Service temporarily unavailable',
    });
  });

  it('rate limits API traffic without limiting health probes', async () => {
    const app = createTestApp({ rateLimits: { apiMax: 2, verifyMax: 1000 } });

    await request(app).get('/api').expect(200);
    await request(app).get('/api').expect(200);
    await request(app).get('/api').expect(429, { error: 'Too many requests' });
    await request(app).get('/health/live').expect(200);
  });

  it('applies a stricter limit to key verification', async () => {
    const app = createTestApp({ rateLimits: { apiMax: 1000, verifyMax: 1 } });

    await request(app).get('/api/verify/valid-key').expect(200);
    await request(app).get('/api/verify/valid-key').expect(429, { error: 'Too many requests' });
  });
});
