const winston = require('winston');

function createLogger(config) {
  const formats = [winston.format.timestamp()];
  if (process.stdout.isTTY) {
    formats.push(winston.format.colorize());
  }
  formats.push(
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metadata = Object.keys(meta).length > 0 ? ` meta=${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level}] ${message}${metadata}`;
    }),
  );

  const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(...formats),
    transports: [new winston.transports.Console()],
    silent: !config.logging.enabled,
  });

  function log(level, system, message, meta) {
    const normalizedMeta = normalizeMeta(meta);
    logger.log(level, `[API][${system}] ${message}`, normalizedMeta);
  }

  return { logger, log };
}

function normalizeMeta(meta) {
  if (meta instanceof Error) {
    return { error: meta.message, stack: meta.stack };
  }
  return meta === undefined ? {} : meta;
}

module.exports = { createLogger };
