const express = require('express');
const { canAccessBuild, canAccessModpack, isModpackListed } = require('./visibility');
const { hasControlCharacters } = require('./validation');

const INCLUDE_FULL_CONCURRENCY = 10;

function createRouter({ data, config, version, verifyLimiter }) {
  const router = express.Router();

  async function getModpackResponse(modpack, locals) {
    const builds = await data.getBuilds(modpack);
    return {
      name: modpack.slug,
      display_name: modpack.name,
      recommended: modpack.recommended,
      latest: modpack.latest,
      builds: builds.filter((build) => canAccessBuild(build, locals)).map((build) => build.version),
    };
  }

  async function getBuildResponse(build, include) {
    const mods = await data.getMods(build);
    return {
      minecraft: build.minecraft,
      forge: build.forge,
      java: build.min_java,
      memory: build.min_memory ?? 0,
      mods: mods.map((mod) => {
        const response = {
          name: mod.name,
          version: mod.version,
          md5: mod.md5,
          url: `${config.url.mirror}mods/${mod.name}/${mod.name}-${mod.version}.zip`,
        };

        if (mod.filesize !== null && mod.filesize !== undefined) {
          response.filesize = mod.filesize;
        }

        if (include === 'mods') {
          response.pretty_name = mod.pretty_name;
          response.author = mod.author;
          response.description = mod.description;
          response.link = mod.link;
        }

        return response;
      }),
    };
  }

  router.get('/', (_req, res) => {
    res.redirect('/api/');
  });

  router.get('/api', (_req, res) => {
    res.status(200).json({ api: 'SolderJS', version, stream: 'stable' });
  });

  router.get('/api/modpack', async (req, res) => {
    const modpacks = (await data.getModpacks()).filter((modpack) => isModpackListed(modpack, res.locals));
    const apiResponse = { modpacks: {}, mirror_url: config.url.mirror };

    if (req.query.include === 'full') {
      const responses = await mapWithConcurrency(modpacks, INCLUDE_FULL_CONCURRENCY, (modpack) =>
        getModpackResponse(modpack, res.locals),
      );
      modpacks.forEach((modpack, index) => {
        apiResponse.modpacks[modpack.slug] = responses[index];
      });
    } else {
      for (const modpack of modpacks) {
        apiResponse.modpacks[modpack.slug] = modpack.name;
      }
    }

    res.status(200).json(apiResponse);
  });

  router.get('/api/modpack/:modpack', async (req, res) => {
    if (!validSlug(req.params.modpack)) {
      sendModpackNotFound(res);
      return;
    }

    const modpack = await data.getModpack(req.params.modpack);
    if (!modpack || !canAccessModpack(modpack, res.locals)) {
      sendModpackNotFound(res);
      return;
    }

    res.status(200).json(await getModpackResponse(modpack, res.locals));
  });

  router.get('/api/modpack/:modpack/:build', async (req, res) => {
    if (!validSlug(req.params.modpack) || !validSegment(req.params.build)) {
      sendModpackNotFound(res);
      return;
    }

    const modpack = await data.getModpack(req.params.modpack);
    if (!modpack || !canAccessModpack(modpack, res.locals)) {
      sendModpackNotFound(res);
      return;
    }

    const build = await data.getBuild(modpack, req.params.build);
    if (!build || !canAccessBuild(build, res.locals)) {
      res.status(404).json({ status: 404, error: 'Build does not exist.' });
      return;
    }

    res.status(200).json(await getBuildResponse(build, req.query.include));
  });

  router.get('/api/verify/:key', verifyLimiter, async (req, res) => {
    if (!validSegment(req.params.key)) {
      res.status(404).json({ error: 'Key does not exist' });
      return;
    }

    const keyInfo = await data.verifyKey(req.params.key);
    if (!keyInfo) {
      res.status(404).json({ error: 'Key does not exist' });
      return;
    }

    res.status(200).json({ valid: true, name: keyInfo.name, created_at: keyInfo.created_at });
  });

  return router;
}

function validSlug(value) {
  return validSegment(value);
}

function validSegment(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !hasControlCharacters(value);
}

function sendModpackNotFound(res) {
  res.status(404).json({ status: 404, error: 'Modpack does not exist' });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = { createRouter };
