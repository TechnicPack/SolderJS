const { loadEnvFile } = require('node:process');
loadEnvFile();

const config = require('./config');
const express = require('express');
const pg = require('pg');
const redis = require('redis');
const async = require('async');
const winston = require('winston');

const rclient = redis.createClient(config.redis.port, config.redis.host, {
  no_ready_check: config.redis.no_ready_check,
});

if (config.redis.password) {
  rclient.auth(config.redis.password);
}

const logger = winston.createLogger({
  level: config.logging_level,
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}] ${message}${Object.keys(meta).length ? ` meta=${JSON.stringify(meta)}` : ''}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

const pool = new pg.Pool({
  connectionString: config.pg.options,
  connectionTimeoutMillis: 1000,
  max: 50,
});

const app = express();

app.enable('trust proxy');
app.disable('x-powered-by');

// Set key and client if available
app.use((req, res, next) => {
  const key = req.query.k;
  const cid = req.query.cid;

  /*
   * The full format is:
   *
   * res.locals.client: {
   *   authed: false/true,
   *   modpacks: [id1, id2, ...]
   * }
   *
   * res.locals.key: {
   *   authed: false/true,
   * }
   */
  res.locals.client = { authed: false, modpacks: [] };
  res.locals.key = { authed: false };

  async.parallel(
    [
      (callback) => {
        if (!key) {
          callback();
          return;
        }

        getKeys((err, keys) => {
          if (err) {
            callback(err, null);
            return;
          }

          if (keys.includes(key)) {
            res.locals.key.authed = true;
            log('info', 'Auth', 'Authenticated API key: ' + key);
          }

          callback();
        });
      },
      (callback) => {
        if (!cid) {
          callback();
          return;
        }

        getClients((err, clients) => {
          if (err) {
            callback(err, null);
            return;
          }

          if (clients.includes(cid)) {
            res.locals.client.authed = true;
            log('info', 'Auth', 'Authenticated client ID: ' + cid);
            getClientAccess(cid, (err, modpacks) => {
              if (err) {
                callback(err, null);
                return;
              }

              res.locals.client.modpacks = modpacks;
              log('info', 'Auth', 'Assigned modpack access for client', modpacks);
              callback();
            });
          } else {
            callback();
          }
        });
      },
    ],
    (err) => {
      if (err) {
        log('error', 'Auth', 'Error during authentication processing.', err);
      }
      next();
    },
  );
});

app.get('/', (req, res) => {
  res.redirect('/api/');
});

app.get('/api', (req, res) => {
  res.status(200).json({ api: 'SolderJS', version: '3.0.6', stream: 'stable' });
});

app.get('/api/modpack', (req, res) => {
  const options = {
    include: req.query.include,
  };

  const apiResponse = {};

  getModpacks((err, modpacks) => {
    if (err) {
      res.status(500).json({ error: 'An error has occurred' });
      return;
    }

    apiResponse.modpacks = {};
    apiResponse.mirror_url = config.url.mirror;

    modpacks.forEach((modpack) => {
      if (modpack.hidden) {
        if (res.locals.key.authed) {
          apiResponse.modpacks[modpack.slug] = modpack.name;
        }
      } else if (modpack.private) {
        if (res.locals.key.authed || res.locals.client.modpacks.includes(modpack.id)) {
          apiResponse.modpacks[modpack.slug] = modpack.name;
        }
      } else {
        apiResponse.modpacks[modpack.slug] = modpack.name;
      }
    });

    if (options.include === 'full') {
      // Grab modpack builds async
      async.each(
        modpacks,
        (modpack, callback) => {
          if (apiResponse.modpacks[modpack.slug]) {
            getModpackResponse(modpack, res, (err, mObject) => {
              if (err) {
                callback(err);
                return;
              }
              apiResponse.modpacks[modpack.slug] = mObject;
              callback();
            });
          } else {
            callback();
          }
        },
        (err) => {
          if (err) {
            log('error', 'Database', 'Error retrieving builds for modpacks');
            return;
          }

          res.status(200).json(apiResponse);
        },
      );
    } else {
      res.status(200).json(apiResponse);
    }
  });
});

app.get('/api/modpack/:modpack', (req, res) => {
  const slug = req.params.modpack;

  getModpack(slug, (err, modpack) => {
    if (err) {
      res.status(500).json({ error: 'An error has occurred' });
      return;
    }

    if (modpack) {
      getModpackResponse(modpack, res, (err, result) => res.status(200).json(result));
    } else {
      res.status(404).json({ status: 404, error: 'Modpack does not exist' });
    }
  });
});

app.get('/api/modpack/:modpack/:build', (req, res) => {
  const slug = req.params.modpack;
  const buildName = req.params.build;

  const options = {
    include: req.query.include,
  };

  getModpack(slug, (err, modpack) => {
    if (err) {
      res.status(500).json({ error: 'An error has occurred' });
      return;
    }

    if (modpack) {
      getBuild(modpack, buildName, (err, build) => {
        if (err) {
          res.status(500).json({ error: 'An error has occurred' });
          return;
        }

        if (build) {
          if (
            build.is_published &&
            (!build.private || res.locals.key.authed || res.locals.client.modpacks.includes(modpack.id))
          ) {
            getBuildResponse(modpack, build, options, (err, bObject) => res.status(200).json(bObject));
          } else {
            res.status(403).json({ status: 403, error: 'You are not authorized to view this build.' });
          }
        } else {
          res.status(404).json({ status: 404, error: 'Build does not exist.' });
        }
      });
    } else {
      res.status(404).json({ status: 404, error: 'Modpack does not exist' });
    }
  });
});

app.get('/api/verify/:key', (req, res) => {
  const key = req.params.key;

  getKey(key, (err, keyInfo) => {
    if (err) {
      res.status(500).json({ error: 'An error has occurred' });
      return;
    }

    if (keyInfo) {
      res.status(200).json({ valid: true, name: keyInfo.name, created_at: keyInfo.created_at });
    } else {
      res.status(404).json({ error: 'Key does not exist' });
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.sendStatus(404);
});

// General error handler
// eslint-disable-next-line no-unused-vars -- Express.js requires error handling middleware to have 4 arguments
app.use((err, req, res, next) => {
  log('error', 'Server', 'Uncaught error', { stack: err.stack });
  res.status(500).json({ error: 'An unexpected error has occurred' });
});

function getModpackResponse(modpack, res, callback) {
  const mObject = {
    name: modpack.slug,
    display_name: modpack.name,
    recommended: modpack.recommended,
    latest: modpack.latest,
    builds: [],
  };

  getBuilds(modpack, (err, builds) => {
    if (err) {
      callback(err, null);
      log('error', 'Modpack', 'Failed to get builds while building modpack response', err);
      return;
    }

    builds.forEach((build) => {
      if (
        build.is_published &&
        (!build.private || res.locals.key.authed || res.locals.client.modpacks.includes(modpack.id))
      ) {
        mObject.builds.push(build.version);
      }
    });

    callback(err, mObject);
  });
}

function getBuildResponse(modpack, build, options, callback) {
  const bObject = {
    minecraft: build.minecraft,
    forge: build.forge,
    java: build.min_java,
    memory: build.min_memory || 0,
    mods: [],
  };

  getMods(build, (err, mods) => {
    if (err) {
      callback(err, null);
      log('error', 'Mods', 'Failed to get mods while building build response', err);
      return;
    }

    mods.forEach((mod) => {
      const modObject = {
        name: mod.name,
        version: mod.version,
        md5: mod.md5,
        url: config.url.mirror + 'mods/' + mod.name + '/' + mod.name + '-' + mod.version + '.zip',
      };

      if (mod.filesize) {
        modObject['filesize'] = mod.filesize;
      }

      if (options.include === 'mods') {
        modObject['pretty_name'] = mod.pretty_name;
        modObject['author'] = mod.author;
        modObject['description'] = mod.description;
        modObject['link'] = mod.link;
      }

      bObject.mods.push(modObject);
    });

    callback(err, bObject);
  });
}

function getKeys(callback) {
  rclient.get('api:access:keys', (err, res) => {
    if (res) {
      callback(null, JSON.parse(res));
      log('debug', 'Cache', 'Loaded keys');
    } else {
      pool.connect((err, client, done) => {
        if (err) {
          callback(err, null);
          log('error', 'Database', 'Error fetching client from pool', err);
          return;
        }

        const query = 'SELECT * FROM keys';

        client.query(query, (err, result) => {
          done();

          if (err) {
            callback(err, null);
            log('error', 'Database', 'Error running query', err);
            return;
          }

          const keys = result.rows.map((row) => row.api_key);

          rclient.set('api:access:keys', JSON.stringify(keys), 'EX', 60);

          callback(null, keys);
        });
      });
    }
  });
}

function getClients(callback) {
  rclient.get('api:access:clients', (err, res) => {
    if (res) {
      callback(null, JSON.parse(res));
      log('debug', 'Cache', 'Loaded clients');
    } else {
      pool.connect((err, client, done) => {
        if (err) {
          callback(err, null);
          log('error', 'Database', 'Error fetching client from pool', err);
          return;
        }

        const query = 'SELECT * FROM clients';

        client.query(query, (err, result) => {
          done();

          if (err) {
            callback(err, null);
            log('error', 'Database', 'Error running query', err);
            return;
          }

          const clients = result.rows.map((row) => row.uuid);

          rclient.set('api:access:clients', JSON.stringify(clients), 'EX', 60);

          callback(null, clients);
        });
      });
    }
  });
}

function getClientAccess(cid, callback) {
  pool.connect((err, client, done) => {
    if (err) {
      callback(err, null);
      log('error', 'Database', 'Error fetching client from pool', err);
      return;
    }

    const query =
      'SELECT * FROM clients JOIN client_modpack ON clients.id = client_modpack.client_id WHERE clients.uuid=$1';
    const data = [cid];

    client.query(query, data, (err, result) => {
      done();

      if (err) {
        callback(err, null);
        log('error', 'Database', 'Error running query', err);
        return;
      }

      const modpacks = result.rows.map((row) => row.modpack_id);

      callback(null, modpacks);
    });
  });
}

function getModpacks(callback) {
  rclient.get('api:modpacks', (err, res) => {
    if (res) {
      log('debug', 'Cache', 'Loaded modpacks');
      callback(null, JSON.parse(res));
    } else {
      pool.connect((err, client, done) => {
        if (err) {
          callback(err, null);
          log('error', 'Database', 'Error fetching client from pool', err);
          return;
        }

        const query = 'SELECT * FROM modpacks ORDER BY id';

        client.query(query, (err, result) => {
          done();

          if (err) {
            callback(err, null);
            log('error', 'Database', 'Error running query', err);
            return;
          }

          if (result.rows) {
            rclient.set('api:modpacks', JSON.stringify(result.rows), 'EX', 60 * 5);
          }

          callback(null, result.rows);
        });
      });
    }
  });
}

function getModpack(slug, callback) {
  rclient.get('api:modpack:' + slug, (err, res) => {
    if (res) {
      log('debug', 'Cache', 'Loaded modpack', slug);
      callback(null, JSON.parse(res));
    } else {
      pool.connect((err, client, done) => {
        if (err) {
          callback(err, null);
          log('error', 'Database', 'Error fetching client from pool', err);
          return;
        }

        const query = 'SELECT * FROM modpacks WHERE slug=$1 ORDER BY id LIMIT 1';
        const data = [slug];

        client.query(query, data, (err, result) => {
          done();

          if (err) {
            callback(err, null);
            log('error', 'Database', 'Error running query', err);
            return;
          }

          if (result.rows[0]) {
            rclient.set('api:modpack:' + slug, JSON.stringify(result.rows[0]), 'EX', 60 * 5);
          }

          callback(null, result.rows[0]);
        });
      });
    }
  });
}

function getBuilds(modpack, callback) {
  rclient.get('api:modpack:builds:' + modpack.id, (err, res) => {
    if (res) {
      log('debug', 'Cache', 'Loaded builds', modpack.slug);
      callback(null, JSON.parse(res));
    } else {
      pool.connect((err, client, done) => {
        if (err) {
          callback(err, null);
          log('error', 'Database', 'Error fetching client from pool', err);
          return;
        }

        const query = 'SELECT * FROM builds WHERE modpack_id=$1::int ORDER BY id';
        const data = [modpack.id];

        client.query(query, data, (err, result) => {
          done();

          if (err) {
            callback(err, null);
            log('error', 'Database', 'Error running query', err);
            return;
          }

          if (result.rows) {
            rclient.set('api:modpack:builds:' + modpack.id, JSON.stringify(result.rows), 'EX', 60 * 5);
          }

          callback(null, result.rows);
        });
      });
    }
  });
}

function getBuild(modpack, build, callback) {
  rclient.get('api:build:' + modpack.id + ':' + build, (err, res) => {
    if (res) {
      log('debug', 'Cache', 'Loaded build', [modpack.slug, build]);
      callback(null, JSON.parse(res));
    } else {
      pool.connect((err, client, done) => {
        if (err) {
          callback(err, null);
          log('error', 'Database', 'Error fetching client from pool', err);
          return;
        }

        const query = 'SELECT * FROM builds WHERE modpack_id=$1::int AND version=$2 LIMIT 1';
        const data = [modpack.id, build];

        client.query(query, data, (err, result) => {
          done();

          if (err) {
            callback(err, null);
            log('error', 'Database', 'Error running query', err);
            return;
          }

          if (result.rows[0]) {
            rclient.set('api:build:' + modpack.id + ':' + build, JSON.stringify(result.rows[0]), 'EX', 60 * 5);
          }

          callback(null, result.rows[0]);
        });
      });
    }
  });
}

function getMods(build, callback) {
  rclient.get('api:mods:' + build.id, (err, res) => {
    if (res) {
      log('debug', 'Cache', 'Loaded mods', build.id);
      callback(null, JSON.parse(res));
    } else {
      pool.connect((err, client, done) => {
        if (err) {
          callback(err, null);
          log('error', 'Database', 'Error fetching client from pool', err);
          return;
        }

        const query =
          'SELECT mods.id, * FROM build_modversion AS bmv INNER JOIN modversions AS mv ON mv.id = bmv.modversion_id INNER JOIN mods ON mods.id = mv.mod_id WHERE bmv.build_id=$1::int ORDER BY mods.name';
        const data = [build.id];

        client.query(query, data, (err, result) => {
          done();

          if (err) {
            callback(err, null);
            log('error', 'Database', 'Error running query', err);
            return;
          }

          if (result.rows) {
            rclient.set('api:mods:' + build.id, JSON.stringify(result.rows), 'EX', 60 * 5);
          }

          callback(null, result.rows);
        });
      });
    }
  });
}

function getKey(key, callback) {
  pool.connect((err, client, done) => {
    if (err) {
      callback(err, null);
      log('error', 'Database', 'Error fetching client from pool', err);
      return;
    }

    const query = 'SELECT * FROM keys WHERE api_key=$1 LIMIT 1';
    const data = [key];

    client.query(query, data, (err, result) => {
      done();

      if (err) {
        callback(err, null);
        log('error', 'Database', 'Error running query', err);
        return;
      }

      if (result.rows[0]) {
        callback(null, result.rows[0]);
      } else {
        callback(null, null);
      }
    });
  });
}

function log(level, system, msg, meta) {
  if (config.logging) {
    if (meta) {
      logger.log(level, '[API][' + system + '] ' + msg, meta);
    } else {
      logger.log(level, '[API][' + system + '] ' + msg);
    }
  }
}

const server = app.listen(config.web.port, config.web.host, (error) => {
  if (error) {
    throw error;
  }

  log('info', 'Server', `Server running on port ${JSON.stringify(server.address())}`);
});

// Handle pm2 reloads gracefully
process.on('SIGINT', () => {
  server.close(() => {
    log('info', 'Server', 'Server stopped, shutting down');
    process.exit(0);
  });
});
