const express = require('express');
const router = express.Router()
var request = require("request");

const jwt = require('jsonwebtoken')
const verifyToken = require('./verify-token');


router.post('/login', (req, res) => {

    const user = req.body;
    const username = user.username;
    const password = user.password;
    // console.log(user);
    var options = {
        method: 'POST',
        url: (process.env.openIDDirectAccessEnpoint),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        form: {
            username: username, 
            password: password, 
            client_id: (process.env.openIDClientID),
            grant_type: 'password',
			client_secret: (process.env.openIDClientSecret)
        }
    };

    request(options, function (error, response, body) {
        if (error) throw new Error(error);

        var json = (JSON.parse(body));
        var fred = jwt.decode(json.access_token);       
            
		// console.log(fred);
		
		res.status(200).json(json);

    });
	
})

module.exports = router;