const config = {};

config.redis = {};
config.web = {};
config.url = {};
config.pg = {};

config.logging = Boolean(parseInt(process.env.NODE_LOGGING)) || true;
config.logging_level = process.env.LOGGING_LEVEL || 'debug';

config.web.host = process.env.HOST || 'localhost';
config.web.port = parseInt(process.env.PORT) || 3000;

config.redis.host = process.env.REDIS_HOST || 'localhost';
config.redis.port = parseInt(process.env.REDIS_PORT) || 6379;
config.redis.password = process.env.REDIS_PASSWORD || null;
config.redis.no_ready_check = Boolean(parseInt(process.env.REDIS_NO_READY_CHECK)) || false;

config.url.mirror = 'http://mirror.technicpack.net/Technic/';

config.pg.options = process.env.DATABASE_URL || 'localhost';

module.exports = config;
