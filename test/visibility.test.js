const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { canAccessBuild, canAccessModpack, isModpackListed } = require('../src/visibility');
const { auth, builds, modpacks } = require('./fixtures');

describe('modpack visibility', () => {
  it('lists public modpacks anonymously', () => {
    assert.equal(isModpackListed(modpacks.public, auth.anonymous), true);
  });

  it('only lists hidden modpacks for credentials with access', () => {
    assert.equal(isModpackListed(modpacks.hidden, auth.anonymous), false);
    assert.equal(isModpackListed(modpacks.hidden, auth.key), true);
  });

  it('only lists private modpacks for credentials with access', () => {
    assert.equal(isModpackListed(modpacks.private, auth.anonymous), false);
    assert.equal(isModpackListed(modpacks.private, auth.privateClient), true);
  });

  it('allows direct access to hidden, non-private modpacks', () => {
    assert.equal(canAccessModpack(modpacks.hidden, auth.anonymous), true);
  });

  it('denies direct access to private modpacks without access', () => {
    assert.equal(canAccessModpack(modpacks.private, auth.anonymous), false);
    assert.equal(canAccessModpack(modpacks.private, auth.privateClient), true);
  });
});

describe('build visibility', () => {
  it('allows published public builds', () => {
    assert.equal(canAccessBuild(builds.public, auth.anonymous), true);
  });

  it('never allows unpublished builds', () => {
    assert.equal(canAccessBuild(builds.unpublished, auth.anonymous), false);
    assert.equal(canAccessBuild(builds.unpublished, auth.key), false);
  });

  it('only allows private builds for credentials with modpack access', () => {
    assert.equal(canAccessBuild(builds.privateBuild, auth.anonymous), false);
    assert.equal(canAccessBuild(builds.privateBuild, auth.publicClient), true);
    assert.equal(canAccessBuild(builds.privateBuild, auth.key), true);
  });
});
