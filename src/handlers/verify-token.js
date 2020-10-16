const jwt = require('jsonwebtoken');
const _ = require('lodash');

// Verify using getKey callback
// Uses https://github.com/auth0/node-jwks-rsa as a way to fetch the keys.
const jwksClient = require('jwks-rsa');


async function getSigningKey(token) {
	return new Promise(function(resolve, reject){
		const client = jwksClient({
			strictSsl: true, // Default value
			jwksUri: (process.env.jwksUri)
		});
		const decoded = jwt.decode(token, {complete: true});
		client.getSigningKey(decoded.header.kid, function(err, key) {
			if(err) {
				console.log(err);
				reject(err);
			} else {
				const signingKey = key.publicKey || key.rsaPublicKey;
				resolve(signingKey);
			}
		});
	});
}
module.exports = async (req, res, next) => {
		console.log('Verifying...');
    try {
			if(req.headers.authorization){
				const token = req.headers.authorization.split(' ')[1]
				const signingKey = await getSigningKey(token);
				const options = { ignoreExpiration: false, maxAge : '10h', algorithms: ['RS256'] };
				const claimPath = process.env.AccessClaimPath;
				jwt.verify(token, signingKey, options, function(err, vdecoded) {
						if(err){
							console.log(err);
							throw new Error('Unable to verify token');
						}

						// console.log('Checking userAccess', vdecoded);

						req.userData = vdecoded;

						let access = null;
						const aClaims = claimPath.split(',').map((c) => {
							return c.trim();
						});

						for(let i = 0; i < aClaims.length; i++) {
							console.log('Claims: ', aClaims[i]);
							claim = aClaims[i];
							access = _.get(vdecoded, claim);
							if(access != null) {
								console.log('Got one!');
								break;
							}
						}

						if(!access) {
							throw Error('Claims Path could not be found');
						}

						req.userAccess = access;
						//console.log('userAccess', req.userAccess, ', access claim: ', claimPath);
						//req.userAccess = vdecoded[claimPath];
						// Check Roles at least one role is present process.env.AccessReadRole, process.env.AccessWriteRole, process.env.AccessAdminRole
						if(req.userAccess.indexOf(process.env.AccessReadRole) === -1 && req.userAccess.indexOf(process.env.AccessWriteRole) === -1 && req.userAccess.indexOf(process.env.AccessAdminRole) === -1){
							throw new Error('Roles not found');
						}
					});

				next();
			} else {
				throw(new Error('Authorisation header missing'))
			}

    } catch (err) {
			console.log(err);
      return res.status(401).json({
				message: "Authorisation failed."
			});
    }
}
