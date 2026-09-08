function hasModpackAccess(modpackId, locals) {
  return locals.key.authed || (locals.client.authed && locals.client.modpacks.includes(modpackId));
}

function isModpackListed(modpack, locals) {
  if (!modpack.hidden && !modpack.private) {
    return true;
  }
  return hasModpackAccess(modpack.id, locals);
}

function canAccessModpack(modpack, locals) {
  return !modpack.private || hasModpackAccess(modpack.id, locals);
}

function canAccessBuild(build, locals) {
  if (!build.is_published) {
    return false;
  }
  return !build.private || hasModpackAccess(build.modpack_id, locals);
}

module.exports = { hasModpackAccess, isModpackListed, canAccessModpack, canAccessBuild };
