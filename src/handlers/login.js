
const express = require('express');
const router = express.Router();
const https = require('https');
const querystring = require('querystring');

const jwt = require('jsonwebtoken')
const verifyToken = require('./verify-token');

const logger = require('./../utils/logger');


router.post('/login', (req, res) => {
    const user = req.body;
    const username = user.username;
    const password = user.password;

		// console.log(user);

		const form = {
				username: username,
				password: password,
				client_id: (process.env.openIDClientID),
				grant_type: 'password',
				client_secret: (process.env.openIDClientSecret)
		};
		const formData = querystring.stringify(form);
		const contentLength = formData.length;

		const options = {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				'Content-Length': contentLength,
			}
		}
		logger.call('oid enpoint: ' + process.env.openIDDirectAccessEnpoint);
		const reqs = https.request(process.env.openIDDirectAccessEnpoint, options, (ress) => {
			ress.setEncoding('utf8');
			ress.on('data', (d) => {
				logger.call('OID Data: ' + (d ? d.length : 0));
				const json = JSON.parse(d);
				if(json.error && json.error.length != 0) {
					return res.status(500).json(json);
				}
				var fred = jwt.decode(ress.access_token);
    		return res.status(200).json(json);
  		});
		});

		reqs.on('error', (e) => {
			return res.status(500).json({
				message: 'Error loging in.',
				error: e
			})
		});

		reqs.write(formData);

		reqs.end();
});

module.exports = router;
