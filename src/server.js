// custom-env wouldn't load direct from NODE_ENV for some reason
if(process.env.NODE_ENV.trim().toLowerCase() === 'production') {
	require('custom-env').env('production');
} else {
	require('custom-env').env('development');
}

const logger = require('./utils/logger');

logger.info(`Running in ${process.env.NODE_ENV} mode!`);

logger.info('Running on ' + process.env.host);

const Minio = require('minio');

// Express HTTP server
const express = require('express');
const server = express();
const router = express.Router();
const bodyParser = require('body-parser');
const cors = require('cors');

//Setup CORS
let corsOptions = {};
if(process.env.corsEnabled.toLowerCase() === 'true'){
	let whitelist = [];
	if((process.env.allowedOrigins).includes(',')) {
		(process.env.allowedOrigins).split(',').forEach(function (item) {
			whitelist.push(item.trim());
		});
	} else {
		whitelist.push(process.env.allowedOrigins);
	}

	logger.info('Current acceptable CORS addresses: ' + whitelist)
	corsOptions = {
	  origin: function (origin, callback) {
		logger.debug('origin: ' +  origin);
		const index = whitelist.findIndex((w) => {
			return origin && origin.startsWith(w);
		})

		if (index > -1) {
			callback(null, true);
		} else {
			callback(new Error('CORS failed'));
		}
	  }
	}
}



// Middleware

server.use(cors(corsOptions));
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({extended: false}));


// router

const login = require("./handlers/login");
const storage = require("./handlers/storage");

server.use('/auth', login);
server.use('/storage', storage);

server.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
})

server.listen(process.env.listenOn, () => {
		logger.info('Platform: '+process.platform);
		logger.info('Listening on port '+process.env.listenOn);
	})
