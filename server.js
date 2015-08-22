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
	var rclient = require("redis").createClient(redisUrl.port, redisUrl.hostname, {no_ready_check: true});

	rclient.auth(redisUrl.auth.split(":")[1]);
} else {
	var rclient = redis.createClient(config.redis.port, config.redis.host);
}

var connection = mysql.createPool({
	host: config.mysql.host,
	user: config.mysql.user,
	password: config.mysql.pass,
	port: config.mysql.port,
	database: config.mysql.name
});

var logger = new (winston.Logger)({
		    transports: [
		      new (winston.transports.Console)({ level: config.logging_level })
		    ]
		  });

var app = express();

app.enable('trust proxy');

app.get('/api', function(req, response) {
	response.status(200).json({api: "SolderAPI", version: "0.1", stream: "beta"}).end();
});

function log(level, system, msg, meta) {
	if (config.logging && config.logging != 0) {

		if (meta) {
			logger.log(level, '[API][' + system + '] ' + msg, meta);
		} else {
			logger.log(level, '[API][' + system + '] ' + msg);
		}
	}
}

app.listen(config.web.port);

log('info', 'Server', 'Server running on port ' + config.web.port);
