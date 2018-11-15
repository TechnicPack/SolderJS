require('dotenv').config();

var config = require('./config');
var express = require('express');
var pg = require('pg');
var redis = require('redis');
var async = require('async');
var url = require('url');
var _ = require('underscore');
var winston = require('winston');

var rclient;

if (process.env.REDISCLOUD_URL) {
	var redisUrl = url.parse(process.env.REDISCLOUD_URL);
	rclient = redis.createClient(redisUrl.port, redisUrl.hostname, {no_ready_check: true});

	rclient.auth(redisUrl.auth.split(':')[1]);
} else {
	rclient = redis.createClient(config.redis.port, config.redis.host);
}

var logger = winston.createLogger({
	level: config.logging_level,
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.printf(info => {
			return `${info.timestamp} [${info.level}] ${info.message}`;
		})
	),
	transports: [
		new winston.transports.Console()
	]
});

var pool = new pg.Pool({
	connectionString: config.pg.options,
	connectionTimeoutMillis: 1000,
	max: 50
});

var app = express();

app.enable('trust proxy');

// Set key and client if available
app.use(function(req, response, next) {
	var key = req.query.k;
	var cid = req.query.cid;

	req.access = {
		client: { authed: false },
		key: { authed: false }
	};

	async.parallel([
		function(callback) {
			getKeys(function(err, keys) {
				if (err) {
					return callback(err, null);
				}

				if (_.contains(keys, key)) {
					req.access.key = {authed: true, key: key};
					log('info', 'Auth', 'Authenticated API key: ' + key);
				}
				return callback();
			});
		},
		function(callback) {
			getClients(function(err, clients) {
				if (err) {
					return callback(err, null);
				}

				if (_.contains(clients, cid)) {
					req.access.client = {authed: true, client: cid};
					log('info', 'Auth', 'Authenticated Client ID: ' + cid);
					getClientAccess(cid, function(err, modpacks) {
						if (err) {
							return callback(err, null);
						}
						req.access.client.modpacks = modpacks;
						log('info', 'Auth', 'Assigned modpack access for client', modpacks);
						return callback();
					});

				} else {
					return callback();
				}

			});
		},
	], function(err) {
		if (err) {
			log('error', 'Auth', 'Error during authentication processing.', err);
		}
		next();
	});

});

app.get('/api', function(req, response) {
	return response.status(200).json({api: 'SolderJS', version: '0.1', stream: 'beta'}).end();
});

app.get('/api/modpack', function(req, response) {
	var options = {
		include: req.query.include
	};

	var apiResponse = {};

	getModpacks(function(err, modpacks) {
		if (err) {
			return response.status(500).json({error: 'An error has occured'});
		}

		apiResponse.modpacks = {};
		apiResponse.mirror_url = config.url.mirror;

		_.each(modpacks, function(modpack) {
			if (modpack.hidden) {
				if (req.access.key.authed) {
					apiResponse.modpacks[modpack.slug] = modpack.name;
				}
			} else if (modpack.private) {
				if (req.access.key.authed || _.contains(req.access.client.modpacks, modpack.id)) {
					apiResponse.modpacks[modpack.slug] = modpack.name;
				}
			} else {
				apiResponse.modpacks[modpack.slug] = modpack.name;
			}
		});

		if (options.include == 'full') {

			// Grab modpack builds async
			async.each(modpacks, function(modpack, callback) {
				if (apiResponse.modpacks[modpack.slug]) {
					getModpackResponse(modpack, req, function(err, mObject) {
						if (err) {
							return callback(err);
						}
						apiResponse.modpacks[modpack.slug] = mObject;
						callback();
					});
				} else {
					callback();
				}
			}, function(err) {
				if (err) {
					return log('error', 'Database', 'Error retrieving builds for modpacks');
				}

				return response.status(200).json(apiResponse);

			});
		} else {
			return response.status(200).json(apiResponse);
		}

	});
});

app.get('/api/modpack/(:modpack)', function(req, response) {
	var slug = req.params.modpack;

	getModpack(slug, function(err, modpack) {
		if (err) {
			return response.status(500).json({error: 'An error has occured'});
		}

		if (modpack) {
			getModpackResponse(modpack, req, function(err, res) {
				return response.status(200).json(res);
			});
		} else {
			return response.status(404).json({status: 404, error: 'Modpack does not exist'});
		}

	});
});

app.get('/api/modpack/:modpack/:build', function(req, response) {
	var slug = req.params.modpack;
	var build = req.params.build;

	var options = {
		include: req.query.include
	};

	getModpack(slug, function(err, modpack) {
		if (err) {
			return response.status(500).json({error: 'An error has occured'});
		}

		if (modpack) {
			getBuild(modpack, build, function(err, build) {
				if (err) {
					return response.status(500).json({error: 'An error has occured'});
				}

				if (build) {
					if (build.is_published && (!build.private || ( req.access.key.authed || _.contains(req.access.client.modpacks, modpack.id)))) {
						getBuildResponse(modpack, build, options, function(err, bObject) {
							return response.status(200).json(bObject);
						});
					} else {
						return response.status(403).json({status: 403, error: 'You are not authorized to view this build.'});
					}
				} else {
					return response.status(404).json({status: 404, error: 'Build does not exist.'});
				}
			});
		} else {
			return response.status(404).json({status: 404, error: 'Modpack does not exist'});
		}

	});
});

app.get('/api/verify/(:key)', function(req, response) {
	var key = req.params.key;

	getKey(key, function(err, key) {
		if (err) {
			return response.status(500).json({error: 'An error has occured'});
		}

		if (key) {
			return response.status(200).json({valid: 'Key Validated.', name: key.name, created_at: key.created_at});
		} else {
			return response.status(200).json({'error': 'Key does not exist'});
		}
	});
});

function getModpackResponse(modpack, req, callback) {
	var mObject = {
		name: modpack.slug,
		display_name: modpack.name,
		url: modpack.url,
		icon: modpack.icon_url,
		icon_md5: modpack.icon_md5,
		logo: modpack.logo_url,
		logo_md5: modpack.logo_md5,
		background: modpack.background_url,
		background_md5: modpack.background_md5,
		recommended: modpack.recommended,
		latest: modpack.latest,
		builds: []
	};

	getBuilds(modpack, function(err, builds) {
		if (err) {
			callback(err, null);
			return log('error', 'Modpack', 'Failed to get builds while building modpack response', err);
		}

		_.each(builds, function(build) {
			if (build.is_published && (!build.private || ( req.access.key.authed || _.contains(req.access.client.modpacks, modpack.id)))) {
				mObject.builds.push(build.version);
			}
		});

		return callback(err, mObject);
	});
}

function getBuildResponse(modpack, build, options, callback) {

	var bObject = {
		minecraft: build.minecraft,
		minecraft_md5: build.minecraft_md5,
		forge: build.forge,
		java: build.min_java,
		memory: build.min_memory ? build.min_memory.toString() : null,
		mods: []
	};

	getMods(build, function(err, mods) {
		if (err) {
			callback(err, null);
			return log('error', 'Mods', 'Failed to get mods while building build response', err);
		}

		_.each(mods, function(mod) {
			var modObject = {
				name: mod.name,
				version: mod.version,
				md5: mod.md5,
				url: config.url.mirror + 'mods/' + mod.name + '/' + mod.name + '-' + mod.version + '.zip'
			};

			if (mod.filesize) {
				modObject['filesize'] = mod.filesize;
			}

			if (options.include == 'mods') {
				modObject['pretty_name'] = mod.pretty_name;
				modObject['author'] = mod.author;
				modObject['description'] = mod.description;
				modObject['link'] = mod.link;
			}

			bObject.mods.push(modObject);
		});

		return callback(err, bObject);
	});
}

function getKeys(callback) {
	rclient.get('api:access:keys', function(err, res) {
		if (res) {
			callback(null, JSON.parse(res));
			log('debug', 'Cache', 'Loaded keys');
		} else {
			pool.connect(function(err, client, done) {
				if (err) {
					callback(err, null);
					return log('error', 'Database', 'Error fetching client from pool', err);
				}

				var query = 'SELECT * FROM keys';

				client.query(query, function(err, result) {
					done();

					if (err) {
						callback(err, null);
						return log('error', 'Database', 'Error running query', err);
					}

					var keys = [];

					_.each(result.rows, function(key) {
						keys.push(key.api_key);
					});

					rclient.set('api:access:keys', JSON.stringify(keys));
					rclient.expire('api:access:keys', 60);

					callback(null, keys);
				});
			});
		}
	});
}

function getClients(callback) {
	rclient.get('api:access:clients', function(err, res) {
		if (res) {
			callback(null, JSON.parse(res));
			log('debug', 'Cache', 'Loaded clients');
		} else {
			pool.connect(function(err, client, done) {
				if (err) {
					callback(err, null);
					return log('error', 'Database', 'Error fetching client from pool', err);
				}

				var query = 'SELECT * FROM clients';

				client.query(query, function(err, result) {
					done();

					if (err) {
						callback(err, null);
						return log('error', 'Database', 'Error running query', err);
					}

					var clients = [];

					_.each(result.rows, function(client) {
						clients.push(client.uuid);
					});

					rclient.set('api:access:clients', JSON.stringify(clients));
					rclient.expire('api:access:clients', 60);

					callback(null, clients);
				});
			});
		}
	});
}

function getClientAccess(cid, callback) {
	pool.connect(function(err, client, done) {
		if (err) {
			callback(err, null);
			return log('error', 'Database', 'Error fetching client from pool', err);
		}

		var query = 'SELECT * FROM clients JOIN client_modpack ON clients.id = client_modpack.client_id WHERE clients.uuid=$1';
		var data = [cid];

		client.query(query, data, function(err, result) {
			done();

			if (err) {
				callback(err, null);
				return log('error', 'Database', 'Error running query', err);
			}

			var modpacks = [];

			_.each(result.rows, function(modpack) {
				modpacks.push(modpack.modpack_id);
			});
			callback(null, modpacks);
		});
	});
}

function getModpacks(callback) {
	rclient.get('api:modpacks', function(err, res) {
		if (res) {
			log('debug', 'Cache', 'Loaded modpacks');
			callback(null, JSON.parse(res));
		} else {
			pool.connect(function(err, client, done) {
				if (err) {
					callback(err, null);
					return log('error', 'Database', 'Error fetching client from pool', err);
				}

				var query = 'SELECT * FROM modpacks ORDER BY id ASC';

				client.query(query, function(err, result) {
					done();

					if (err) {
						callback(err, null);
						return log('error', 'Database', 'Error running query', err);
					}

					if (result.rows) {
						rclient.set('api:modpacks', JSON.stringify(result.rows));
						rclient.expire('api:modpacks', 60 * 5);
					}

					callback(null, result.rows);
				});
			});
		}
	});
}

function getModpack(slug, callback) {
	rclient.get('api:modpack:' + slug, function(err, res) {
		if (res) {
			log('debug', 'Cache', 'Loaded modpack', slug);
			callback(null, JSON.parse(res));
		} else {
			pool.connect(function(err, client, done) {
				if (err) {
					callback(err, null);
					return log('error', 'Database', 'Error fetching client from pool', err);
				}

				var query = 'SELECT * FROM modpacks WHERE slug=$1 ORDER BY id ASC LIMIT 1';
				var data = [slug];

				client.query(query, data, function(err, result) {
					done();

					if (err) {
						callback(err, null);
						return log('error', 'Database', 'Error running query', err);
					}

					if (result.rows[0]) {
						rclient.set('api:modpack:' + slug, JSON.stringify(result.rows[0]));
						rclient.expire('api:modpack:' + slug, 60 * 5);
					}

					callback(null, result.rows[0]);
				});
			});
		}
	});
}

function getBuilds(modpack, callback) {
	rclient.get('api:modpack:builds:' + modpack.id, function(err, res) {
		if (res) {
			log('debug', 'Cache', 'Loaded builds', modpack.slug);
			callback(null, JSON.parse(res));
		} else {
			pool.connect(function(err, client, done) {
				if (err) {
					callback(err, null);
					return log('error', 'Database', 'Error fetching client from pool', err);
				}

				var query = 'SELECT * FROM builds WHERE modpack_id=$1::int';
				var data = [modpack.id];

				client.query(query, data, function(err, result) {
					done();

					if (err) {
						callback(err, null);
						return log('error', 'Database', 'Error running query', err);
					}

					if (result.rows) {
						rclient.set('api:modpack:builds:' + modpack.id, JSON.stringify(result.rows));
						rclient.expire('api:modpack:builds:' + modpack.id, 60 * 5);
					}

					callback(null, result.rows);
				});
			});
		}
	});
}

function getBuild(modpack, build, callback) {
	rclient.get('api:build:' + modpack.id + ':' + build, function(err, res) {
		if (res) {
			log('debug', 'Cache', 'Loaded build', [modpack.slug, build]);
			callback(null, JSON.parse(res));
		} else {
			pool.connect(function(err, client, done) {
				if (err) {
					callback(err, null);
					return log('error', 'Database', 'Error fetching client from pool', err);
				}

				var query = 'SELECT * FROM builds WHERE modpack_id=$1::int AND version=$2 LIMIT 1';
				var data = [modpack.id, build];

				client.query(query, data, function(err, result) {
					done();

					if (err) {
						callback(err, null);
						return log('error', 'Database', 'Error running query', err);
					}

					if (result.rows[0]) {
						rclient.set('api:build:' + modpack.id + ':' + build, JSON.stringify(result.rows[0]));
						rclient.expire('api:build:' + modpack.id + ':' + build, 60 * 5);
					}

					callback(null, result.rows[0]);
				});
			});
		}
	});
}

function getMods(build, callback) {
	rclient.get('api:mods:' + build.id, function(err, res) {
		if (res) {
			log('debug', 'Cache', 'Loaded mods', build.id);
			callback(null, JSON.parse(res));
		} else {
			pool.connect(function(err, client, done) {
				if (err) {
					callback(err, null);
					return log('error', 'Database', 'Error fetching client from pool', err);
				}

				var query = 'SELECT mods.id, * FROM build_modversion AS bmv INNER JOIN modversions AS mv ON mv.id = bmv.modversion_id INNER JOIN mods ON mods.id = mv.mod_id WHERE bmv.build_id=$1::int ORDER BY mods.name ASC';
				var data = [build.id];

				client.query(query, data, function(err, result) {
					done();

					if (err) {
						callback(err, null);
						return log('error', 'Database', 'Error running query', err);
					}

					if (result.rows) {
						rclient.set('api:mods:' + build.id, JSON.stringify(result.rows));
						rclient.expire('api:mods:' + build.id, 60 * 5);
					}

					callback(null, result.rows);
				});
			});
		}
	});
}

function getKey(key, callback) {
	pool.connect(function(err, client, done) {
		if (err) {
			callback(err, null);
			return log('error', 'Database', 'Error fetching client from pool', err);
		}

		var query = 'SELECT * FROM keys WHERE api_key=$1 LIMIT 1';
		var data = [key];

		client.query(query, data, function(err, result) {
			done();

			if (err) {
				callback(err, null);
				return log('error', 'Database', 'Error running query', err);
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
	if (config.logging && config.logging != 0) {
		if (meta) {
			logger.log(level, '[API][' + system + '] ' + msg, meta);
		} else {
			logger.log(level, '[API][' + system + '] ' + msg);
		}
	}
}
app.listen(config.web.port, function() {
	log('info', 'Server', 'Server running on port ' + config.web.port);
});
