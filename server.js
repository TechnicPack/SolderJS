require('newrelic');

var config = require('./config');
var express = require('express');
var pg = require('pg');
var redis = require('redis');
var request = require('request');
var async = require('async');
var url = require('url');
var _ = require('underscore');
var winston = require('winston');

if (process.env.REDISCLOUD_URL) {
	var redisUrl   = url.parse(process.env.REDISCLOUD_URL);
	var rclient = redis.createClient(redisUrl.port, redisUrl.hostname, {no_ready_check: true});

	rclient.auth(redisUrl.auth.split(":")[1]);
} else {
	var rclient = redis.createClient(config.redis.port, config.redis.host);
}

var logger = new (winston.Logger)({
		    transports: [
		      new (winston.transports.Console)({ level: config.logging_level })
		    ]
		  });

var app = express();

app.enable('trust proxy');

app.get('/api', function(req, response) {
	response.status(200).json({api: "SolderJS", version: "0.1", stream: "beta"}).end();
});

app.get('/api/modpack', function(req, response) {
	var options = {
		include: req.query.include
	}

	getModpacks(options, function(err, modpacks) {
		response.status(200).json(modpacks);
	});
});

function getModpacks(options, callback) {
	pg.connect(config.pg.url, function(err, client, done) {
		if (err) {
			callback(err, null);
			return log('error', 'Database', 'Error fetching client from pool', err);
		}

		client.query('SELECT * FROM modpacks', function(err, result) {
			done();

			if (err) {
				callback(err, null);
				return log('error', 'Database', 'Error running query', err);
			}

			callback(null, result.rows);
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
