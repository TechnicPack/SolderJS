var config = {}

config.redis = {}
config.web = {}
config.url = {}
config.pgsql = {}

config.logging = process.env.NODE_LOGGING || 1;
config.logging_level = process.env.LOGGING_LEVEL || 'debug';

config.web.port = process.env.PORT || 3000;

config.redis.host = process.env.REDISCLOUD_URL || 'localhost';
config.redis.port = 6379;

config.url.repo = "http://mirror.technicpack.net/Technic/";
config.url.mirror = "http://mirror.technicpack.net/Technic/";

config.pgsql.url = process.env.DATABASE_URL || 'localhost';

module.exports = config;
