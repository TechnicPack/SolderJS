const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createAuthMiddleware, maskCredential } = require('../src/auth');

function request({ query = {} } = {}) {
  return { query };
}

function response() {
  return {
    locals: {},
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('authentication middleware', () => {
  it('does not query the data layer without credentials', async () => {
    let calls = 0;
    const data = {
      getKey: async () => (calls += 1),
      getClientAccess: async () => (calls += 1),
    };
    const middleware = createAuthMiddleware({ data, log() {} });
    const res = response();
    let nextCalled = false;

    await middleware(request(), res, () => {
      nextCalled = true;
    });

    assert.equal(calls, 0);
    assert.equal(nextCalled, true);
    assert.deepEqual(res.locals, {
      key: { authed: false },
      client: { authed: false, modpacks: [] },
    });
  });

  it('authenticates the TechnicSolder k parameter without logging it in full', async () => {
    const logs = [];
    let receivedKey;
    const data = {
      getKey: async (key) => {
        receivedKey = key;
        return { name: 'key' };
      },
      getClientAccess: async () => null,
    };
    const middleware = createAuthMiddleware({ data, log: (...args) => logs.push(args) });
    const res = response();

    await middleware(request({ query: { k: 'secret-api-key' } }), res, () => {});

    assert.equal(receivedKey, 'secret-api-key');
    assert.equal(res.locals.key.authed, true);
    assert.match(logs[0][2], /secr\.\.\.-key/);
    assert.doesNotMatch(logs[0][2], /secret-api-key/);
  });

  it('ignores non-TechnicSolder authentication headers', async () => {
    let calls = 0;
    const data = {
      getKey: async () => (calls += 1),
      getClientAccess: async () => (calls += 1),
    };
    const middleware = createAuthMiddleware({ data, log() {} });
    const req = { query: {}, get: () => 'header-credential' };

    await middleware(req, response(), () => {});

    assert.equal(calls, 0);
  });

  it('authenticates valid clients even when they have no assigned modpacks', async () => {
    const data = { getKey: async () => null, getClientAccess: async () => [] };
    const middleware = createAuthMiddleware({ data, log() {} });
    const res = response();

    await middleware(request({ query: { cid: 'client-id' } }), res, () => {});

    assert.deepEqual(res.locals.client, { authed: true, modpacks: [] });
  });

  it('returns 503 instead of silently continuing when authentication storage fails', async () => {
    const data = {
      getKey: async () => {
        throw new Error('database unavailable');
      },
      getClientAccess: async () => null,
    };
    const middleware = createAuthMiddleware({ data, log() {} });
    const res = response();
    let nextCalled = false;

    await middleware(request({ query: { k: 'key' } }), res, () => {
      nextCalled = true;
    });

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'Service temporarily unavailable' });
    assert.equal(nextCalled, false);
  });

  it('ignores malformed credentials', async () => {
    let calls = 0;
    const data = {
      getKey: async () => (calls += 1),
      getClientAccess: async () => (calls += 1),
    };
    const middleware = createAuthMiddleware({ data, log() {} });

    await middleware(request({ query: { k: ['not', 'a', 'string'] } }), response(), () => {});

    assert.equal(calls, 0);
  });
});

describe('maskCredential', () => {
  it('fully masks short values', () => {
    assert.equal(maskCredential('short'), '***');
  });
});
