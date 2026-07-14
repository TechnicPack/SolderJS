const { createHash } = require('node:crypto');

const AUTH_TTL_SECONDS = 60;
const CONTENT_TTL_SECONDS = 300;

function createData({ pool, cache, log }) {
  const inFlight = new Map();

  async function readCache(key) {
    try {
      const serialized = await cache.get(key);
      if (serialized === null) {
        return { hit: false };
      }
      return { hit: true, value: JSON.parse(serialized) };
    } catch (err) {
      log('warn', 'Cache', 'Cache read failed; falling back to PostgreSQL', { key, error: err.message });
      return { hit: false };
    }
  }

  async function writeCache(key, value, ttl) {
    try {
      await cache.set(key, JSON.stringify(value), { EX: ttl });
    } catch (err) {
      log('warn', 'Cache', 'Cache write failed; continuing without cache', { key, error: err.message });
    }
  }

  async function cachedQuery(key, ttl, query) {
    const cached = await readCache(key);
    if (cached.hit) {
      return cached.value;
    }

    if (inFlight.has(key)) {
      return inFlight.get(key);
    }

    const pending = (async () => {
      const value = await query();
      const effectiveTtl = value === null ? Math.min(ttl, AUTH_TTL_SECONDS) : ttl;
      await writeCache(key, value, effectiveTtl);
      return value;
    })();
    inFlight.set(key, pending);

    try {
      return await pending;
    } finally {
      inFlight.delete(key);
    }
  }

  async function getKey(key) {
    const cacheKey = `api:key:${digest(key)}`;
    return cachedQuery(cacheKey, AUTH_TTL_SECONDS, async () => {
      const result = await pool.query('SELECT name, created_at FROM keys WHERE api_key=$1 LIMIT 1', [key]);
      return result.rows[0] || null;
    });
  }

  async function getClientAccess(clientId) {
    const cacheKey = `api:client:access:${digest(clientId)}`;
    return cachedQuery(cacheKey, AUTH_TTL_SECONDS, async () => {
      const result = await pool.query(
        'SELECT clients.id, client_modpack.modpack_id FROM clients LEFT JOIN client_modpack ON clients.id = client_modpack.client_id WHERE clients.uuid=$1',
        [clientId],
      );
      if (result.rows.length === 0) {
        return null;
      }
      return result.rows.map((row) => row.modpack_id).filter((id) => id !== null);
    });
  }

  async function getModpacks() {
    return cachedQuery('api:modpacks', CONTENT_TTL_SECONDS, async () => {
      const result = await pool.query(
        'SELECT id, slug, name, recommended, latest, hidden, private FROM modpacks ORDER BY id',
      );
      return result.rows;
    });
  }

  async function getModpack(slug) {
    return cachedQuery(`api:modpack:${digest(slug)}`, CONTENT_TTL_SECONDS, async () => {
      const result = await pool.query(
        'SELECT id, slug, name, recommended, latest, hidden, private FROM modpacks WHERE slug=$1 ORDER BY id LIMIT 1',
        [slug],
      );
      return result.rows[0] || null;
    });
  }

  async function getBuilds(modpack) {
    return cachedQuery(`api:modpack:builds:${modpack.id}`, CONTENT_TTL_SECONDS, async () => {
      const result = await pool.query(
        'SELECT id, modpack_id, version, minecraft, forge, min_java, min_memory, private, is_published FROM builds WHERE modpack_id=$1::int ORDER BY id',
        [modpack.id],
      );
      return result.rows;
    });
  }

  async function getBuild(modpack, version) {
    return cachedQuery(`api:build:${modpack.id}:${digest(version)}`, CONTENT_TTL_SECONDS, async () => {
      const result = await pool.query(
        'SELECT id, modpack_id, version, minecraft, forge, min_java, min_memory, private, is_published FROM builds WHERE modpack_id=$1::int AND version=$2 LIMIT 1',
        [modpack.id, version],
      );
      return result.rows[0] || null;
    });
  }

  async function getMods(build) {
    return cachedQuery(`api:mods:${build.id}`, CONTENT_TTL_SECONDS, async () => {
      const result = await pool.query(
        'SELECT mods.id, mods.name, mods.pretty_name, mods.author, mods.description, mods.link, mv.version, mv.md5, mv.filesize FROM build_modversion AS bmv INNER JOIN modversions AS mv ON mv.id = bmv.modversion_id INNER JOIN mods ON mods.id = mv.mod_id WHERE bmv.build_id=$1::int ORDER BY mods.name',
        [build.id],
      );
      return result.rows;
    });
  }

  return { getKey, getClientAccess, getModpacks, getModpack, getBuilds, getBuild, getMods };
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

module.exports = { createData };
