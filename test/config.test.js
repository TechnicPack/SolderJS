const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { loadConfig } = require('../config');

const requiredEnv = { DATABASE_URL: 'postgres://solder:password@localhost:5432/solder' };

describe('loadConfig', () => {
  it('loads safe defaults', () => {
    const config = loadConfig(requiredEnv);

    assert.deepEqual(config.logging, { enabled: true, level: 'info' });
    assert.deepEqual(config.web, { host: 'localhost', port: 3000, trustProxy: false });
    assert.equal(config.redis.port, 6379);
    assert.equal(config.pg.max, 20);
    assert.deepEqual(config.rateLimit, { windowMs: 900000, apiMax: 300, verifyMax: 30 });
    assert.equal(config.url.mirror, 'https://localhost/');
  });

  it('parses explicit false booleans, logging levels, and a trusted proxy hop count', () => {
    const config = loadConfig({
      ...requiredEnv,
      NODE_LOGGING: 'false',
      LOGGING_LEVEL: 'DEBUG',
      TRUST_PROXY: '1',
    });

    assert.deepEqual(config.logging, { enabled: false, level: 'debug' });
    assert.equal(config.web.trustProxy, 1);
  });

  it('normalizes the mirror URL with a trailing slash', () => {
    const config = loadConfig({ ...requiredEnv, MIRROR_URL: 'https://cdn.example.com/mods' });

    assert.equal(config.url.mirror, 'https://cdn.example.com/mods/');
  });

  it('requires a database URL', () => {
    assert.throws(() => loadConfig({}), /DATABASE_URL is required/);
  });

  it('rejects malformed ports, booleans, and operational limits', () => {
    assert.throws(() => loadConfig({ ...requiredEnv, PORT: '3000oops' }), /PORT must be an integer/);
    assert.throws(() => loadConfig({ ...requiredEnv, NODE_LOGGING: 'sometimes' }), /NODE_LOGGING must be one of/);
    assert.throws(() => loadConfig({ ...requiredEnv, LOGGING_LEVEL: 'warning' }), /LOGGING_LEVEL must be one of/);
    assert.throws(() => loadConfig({ ...requiredEnv, TRUST_PROXY: 'true' }), /TRUST_PROXY=true is unsafe/);
    assert.throws(() => loadConfig({ ...requiredEnv, RATE_LIMIT_MAX: '0' }), /RATE_LIMIT_MAX must be an integer/);
  });

  it('rejects non-HTTP mirror URLs', () => {
    assert.throws(() => loadConfig({ ...requiredEnv, MIRROR_URL: 'file:///tmp/mods' }), /must use http or https/);
  });
});
