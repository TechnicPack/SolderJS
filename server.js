const { loadEnvFile } = require('node:process');
const { loadConfig } = require('./config');
const { version } = require('./package.json');
const { createApp } = require('./src/app');
const { createData } = require('./src/data');
const { createDatabase } = require('./src/database');
const { createLogger } = require('./src/logger');

async function main() {
  loadOptionalEnvFile();

  const config = loadConfig();
  const { log } = createLogger(config);
  const database = createDatabase(config, log);
  const data = createData({ pool: database.pool, cache: database.cache, log });
  const app = createApp({ config, data, log, healthCheck: database.healthCheck, version });

  try {
    await database.connect();
    const server = await listen(app, config.web);
    log('info', 'Server', `Server listening on ${config.web.host}:${server.address().port}`);

    let stopping = false;
    const stop = async (signal) => {
      if (stopping) {
        return;
      }
      stopping = true;
      log('info', 'Server', `Received ${signal}; shutting down`);

      try {
        await closeServer(server);
        await database.shutdown();
        log('info', 'Server', 'Shutdown complete');
      } catch (err) {
        log('error', 'Server', 'Graceful shutdown failed', err);
        process.exitCode = 1;
      }
    };

    process.once('SIGINT', () => void stop('SIGINT'));
    process.once('SIGTERM', () => void stop('SIGTERM'));

    return { app, server, stop };
  } catch (err) {
    log('error', 'Server', 'Failed to start', err);
    try {
      await database.shutdown();
    } catch (shutdownError) {
      log('error', 'Server', 'Failed to clean up after startup error', shutdownError);
    }
    throw err;
  }
}

function loadOptionalEnvFile() {
  try {
    loadEnvFile();
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

function listen(app, webConfig) {
  return new Promise((resolve, reject) => {
    const server = app.listen(webConfig.port, webConfig.host);
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.keepAliveTimeout = 5000;

    server.once('error', reject);
    server.once('listening', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    const forceClose = setTimeout(() => server.closeAllConnections(), 10000);
    forceClose.unref();

    server.close((err) => {
      clearTimeout(forceClose);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, loadOptionalEnvFile, listen, closeServer };
