const jwt = require('jsonwebtoken')
const verifyToken = require('./verify-token');
const fs = require("fs");
const path = require("path");
const express = require('express');
const multiparty = require('multiparty');
const router = express.Router()
const uuidv4 = require('uuid/v4');
const Minio = require('minio')
const mime = require('mime');
const url = require('url');
const logger = require('./../utils/logger');

// Asynch Middleware
const asyncMiddleware = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next))
        .catch(next);
};

// MinIO Client Setup
const client = new Minio.Client({
    endPoint: process.env.MinIO_endPoint,
    port: Number(process.env.MinIO_port),
    useSSL: Boolean(process.env.MinIO_useSSL),
    accessKey: process.env.MinIO_accessKey,
    secretKey: process.env.MinIO_secretKey,
	region: process.env.MinIO_DefaultRegion
})

// Functions

function makeBucket(name, region = '') {
	return new Promise(function(resolve, reject){
		if(region === '') {
			region = process.env.MinIO_DefaultRegion; // Default
		}
		try {
			client.makeBucket(name, region, function(err) {
				if (err) {
					console.log(err);
					resolve(false);
				}

				logger.debug('Bucket created successfully in ' + region + '.');
				resolve(true);
			});
		} catch(err) {
			reject(err);
		}
	});
}

function checkBucketExists(name) {
	return new Promise(function(resolve, reject){
		try {
			logger.debug('Looking for bucket... ' + name);
			client.bucketExists(name, function(err, exists) {
				if (err) {
					resolve(false);
				}
				if (exists) {
					resolve(true);
				}
				resolve(false);
			});
		} catch(err) {
			reject(err);
		}
	});
}

function statobject(bucket, file) {
    return new Promise((resolve, reject) => {
		try {
        client.statObject(bucket, file, function(err, stat) {
			if (err) {
				logger.error(err);
				reject(err);
			}
			logger.debug('sta: ' + stat);
			resolve(stat);
		})
		} catch(err) {
			reject(err);
		}
    });
}

function putFileObject(bucket,dstfile,srcfile,metaData) {
    return new Promise((resolve, reject) => {
		try {
			logger.debug(srcfile);
			const fileStream = fs.createReadStream(srcfile)
			const fileStat = fs.stat(srcfile,async function(err, stats) {
				if (err) {
				return logger.error(err)
				}
				await client.putObject(bucket, dstfile, fileStream, stats.size, metaData, function(err, etag) {
					if(err) {
						logger.error(err);
						reject(err);
					}
					resolve(etag) // err should be null
				});
			});
		} catch(err) {
			reject(err);
		}
    });
}

function getobjectToCache(bucket, file) {
    return new Promise((resolve, reject) => {
			try {
				if(process.env.cacheDirectory) {
					let tmpFile = String(process.env.cacheDirectory)+'\\'+file;

					if(process.platform === "win32"){
						tmpFile = tmpFile.replace('/','\\');
					} else {
						tmpFile = tmpFile.replace('\\','/');
					}
					//console.log(tmpFile, ' normalzing...');

					tmpFile = path.normalize(tmpFile);

					//console.log('normalized: ', tmpFile, ', creating stream');


					const fileStream = fs.createWriteStream(tmpFile);
					//console.log('stream created');

					fileStream.on('error', (err) => {
						logger.error('Error in FS: ' + err);
						return reject(err);
					});

					client.getObject(bucket, file, ((err, dataStream) => {
						if (err) {
							fileStream.destroy();
							logger.error('Error in getting object: ' + err);
							return reject(err);
						}

						let size = 0;
						dataStream.on('data', ((chunk) => {
							//console.log('chunky!');
							size += chunk.length
						}));

						dataStream.on('end', (() => {
							logger.debug('End. Total size = ' + size);
							return resolve(tmpFile);
						}));

						dataStream.on('error', ((ex) => {
							logger.error('Error in DS: ' + err);
							return reject(err);
						}));

						dataStream.pipe(fileStream);
					}));

					return resolve(tmpFile);

				} else {
					reject(new Error('No Cache directory Set'));
				}
			} catch(err) {
				reject(err);
			}
  	});
}

function bucketObjectList(bucket) {
    return new Promise((resolve, reject) => {
			try {
				let objects = [];
				//console.log('streaming bucket', bucket);
				let objectsStream = client.listObjectsV2(bucket,'', true,'');
				objectsStream.on('data',async function(obj) {
					//console.log('adding: ', obj.name);
					objects.push(obj.name)
				})
				objectsStream.on('error', function(err) {
					logger.errorg(err)
					reject(err);
				})
				objectsStream.on('end', function() {
					//console.log('end of stream!');
					resolve(objects);

				});
			} catch(err) {
				logger.error('rejecting: ' + err);
				reject(err);
			}
    });
}

function bucketList() {
    return new Promise((resolve, reject) => {
		try {
		client.listBuckets(function(err, buckets) {
		  if (err) reject(err);
		  resolve(buckets);
		});
		} catch(err) {
			reject(err);
		}
    });
}

async function makeBucketIfNotExists(buck, region, tries = 0) {
	if(!region) {
		region = process.env.MinIO_DefaultRegion;
	}
	logger.debug('Checking if bucket "' + buck + '" exists');
	return await checkBucketExists(buck).then((exists) => {
		if(!exists && tries < 3) {
			logger.debug('bucket does not exists, creating ' + buck + ' at ' + region);
			makeBucket(buck, region).then(async () => {
				return await makeBucketIfNotExists(buck, region, ++tries);
			}).catch((err) => {
				throw Error(err);
			});
		} else {
			return exists;
		}
	}).catch((err) => {
		logger.error('error making bucket: ' + err);
		throw Error(err);
	});
}

function mergeBucket(src,dst,urlPart) {
	return new Promise(async (resolve, reject) => {
		try{
			let returnData = [];
			//console.log('getting object list from bucket');
			const srcFiles = await bucketObjectList(src);
			//console.log('Source Files:', srcFiles);
			for(file of srcFiles){
				//console.log('File: ' + file);
				const fileInfo = await statobject(src, file);
				//console.log('Got stat object:', fileInfo);
				if(fileInfo) {
					let previousSubjectIDs = [];
					if(fileInfo.metaData.previousSubjectIDs) {
						previousSubjectIDs = fileInfo.metaData.previousSubjectIDs;
					}
					previousSubjectIDs.push(fileInfo.metaData.subjectid)
					const metaData = {
							'Content-Type': fileInfo.metaData['content-type'],
							'SubjectId': dst,
							'previousSubjectIDs': previousSubjectIDs
					};
					logger.debug('sub meta: ' + metaData);

					let makeTry = 0;

					logger.debug('making bucket if it does not exist:' + dst);
					let exists = await makeBucketIfNotExists(dst);
					if(exists === false){
						return reject(new Error('Unable to create bucket'));
					} else {
						//console.log('creating cache');
						const cachedFile = await getobjectToCache(src,file);
						//console.log('created ', cachedFile);

						try {
							await fs.promises.access(cachedFile, fs.constants.W_OK | fs.constants.R_OK);
							const url = urlPart+dst+'/'+file;
							const prevUrl = urlPart+src+'/'+file;

							const etag = await putFileObject(dst,file,cachedFile,metaData);

							const dstfileInfo = await statobject(dst,file);

							if(dstfileInfo){
								fs.unlink(cachedFile, (err) => {
									if (err) throw err;
									//console.log(cachedFile+' was deleted');

								});

								await client.removeObject(src, file, function(err) {
									if (err) throw err;
								});

								returnData.push({
									status : 'success',
									fileName : file,
									href : url,
									previoushref : prevUrl,
									mimeType : fileInfo.metaData['content-type']
								});

							} else {
								throw(new Error('File not in destination, unable to continue'))
							}


						} catch (err) {
							reject(err);
						}

					}
				} else {
					throw(new Error('Unable to get object info'));
				}

			}
			resolve(returnData);
		} catch(err) {
			reject(err);
		}
	});
}

function buildHRef(protocol, subjectId, newGUID = null) {
	if(!newGUID) {
		return ['https:/', process.env.host.trim(), 'gateway/storage/file', subjectId].join('/');
	}
	return ['https:/', process.env.host.trim(), 'gateway/storage/file', subjectId, newGUID].join('/');
}

const getFileStatResult = async (req,res,next) => {
	if(req.userAccess.indexOf(process.env.AccessReadRole) === -1){ // Make this confirgurable
		res.status(401).json({
			message: "Authorisation failed."
		});
		res.end();
		return;
	}
	client.statObject(req.params.bucket, req.params.file, function(err, stat) {
		if (err) {
			console.log(err);
			if(err.code && err.code == "NotFound") {
				return res.status(404).end();
			}

			res.status(500).json(err);
			return res.end();
		}

		// console.log(stat);

		let meta = {};
		meta.mimeType = stat.metaData['content-type'];
		meta.href = buildHRef(req.protocol, stat.metaData.subjectid);
		meta.filename = '';
		meta.size = stat.size;
		meta.resourceId = stat.metaData.subjectid;

		res.status(200).json(meta);
	})

	return;
}

const getFileResult = async (req,res,next) => {
	if(req.userAccess.indexOf(process.env.AccessReadRole) === -1){ // Make this confirgurable
		res.status(401).json({
			message: "Authorisation failed."
		});
		res.end();
		return;
	}
	client.statObject(req.params.bucket, req.params.file, function(err, stat) {
		if (err) {
			console.log(err)
			if(err.code && err.code == "NotFound") {
				return res.status(404).end();
			}

			res.status(500).json(err);
			return res.end();
		}
		let size = 0
		let miniData = [];
		let contentType = 'application/octet-stream';
		if(stat.metaData['content-type']){
			contentType = stat.metaData['content-type'];
		}
		const headers = {'Content-Type': contentType,'Content-Length': stat.size};
		res.set(headers);
		client.getObject(req.params.bucket, req.params.file, function(err, dataStream) {
		  if (err) {
				res.status(500).json(err);
				return res.end();
		  }

		  dataStream.on('data', function(chunk) {
				if(chunk) {
					miniData.push(chunk);
					size += chunk.length
				}
		  });

		  dataStream.on('end', function() {
				res.end(Buffer.concat(miniData));
				// console.log('End. Total size = ' + size)
		  });

		  dataStream.on('error', function(err) {
				//console.log(err)
				res.status(500).json(err);
				return res.end();
		  });

		  return;
		})
		//res.send(miniData);
		//res.end();
	})

	return;
}

const formPutResult = async (req,res,next) => {

	if(req.userAccess.indexOf(process.env.AccessWriteRole) === -1){ // Make this confirgurable
		res.status(401).json({
			message: "Authorisation failed."
		}).end();
		return;
	}

	const form = new multiparty.Form();
	let count = 0;
	let fileMetadata = {};
	let subjectId = '';
	let flatData = {};
	let returnData = [];

	let size = 0;

	form.on('error', function(err) {
	  return res.status(500).json(err).end();
	});

	form.on('field', function(name, value) {
		if(name === 'metadata') {
			fileMetadata = value;
		}
		if(name === 'subjectId') {
			subjectId = value;
			if(subjectId.trim().length === 0) {
				if(process.env.use_fallback_bucket.trim().toLowerCase() !== 'true') {
					logger.error('OnField: StatusId is empty, and not using fall back!');
					flatData = {
						status: 'fail',
						message : 'OnField: StatusId is empty, and not using fall back!'
					};
					returnData.push(flatData);
					form.destroy();
					return;
				}
				subjectId = process.env.fallback_bucket.trim();
			}
		}
  });


	// Parts are emitted when parsing the form
	form.on('part', async (part) => {
		// You *must* act on the part by reading it, if you want to ignore it, just call "part.resume()"
		if (!part.filename) {
			// filename is not defined when this is a field and not a file
			part.resume();
			return;
		}

		part.on('error', function(err) {
			logger.error('OnError called: ' + err);
			returnData.push({
				message : 'OnError Called',
				error: err
			});
		});

		// filename is defined when this is a file
		count++;
		const fileExt = part.filename.split('.').pop();

		let contentType = part.headers['content-type'];
		if(!contentType) {
			contentType = mime.getType(fileExt);
			if(!contentType) {
				contentType = 'application/octet-stream';
			}
		}

		const metaData = {
			'Content-Type': contentType,
			'SubjectId': subjectId
		};

		if(subjectId.trim().length === 0) {
			if(process.env.use_fallback_bucket.trim().toLowerCase() !== 'true') {
				logger.error('OnPart: StatusId is empty, and not using fall back!');
				flatData = {
					status: 'fail',
					message : 'OnPart: StatusId is empty, and not using fall back!'
				};
				returnData.push(flatData);
				form.destroy();
				return;
			}
			subjectId = process.env.fallback_bucket.trim();
		}

		size = size <= part.byteCount ?  part.byteCount : size;

		const newGUID = uuidv4();

		const region = '';

		logger.debug('FormPutResult: checking if bucket exists:' + subjectId)
		let exists = false;
		try {
			exists = await makeBucketIfNotExists(subjectId);
		} catch(ex) {
			logger.error('Exception checking if bucket exists, or creating it: ' + ex);
			flatData = {
				status: 'fail',
				message : 'Exception checking if bucket exists, or creating it',
				error: ex
			};
			returnData.push(flatData);
			form.destroy();
		}
		logger.debug('bucket exists? ' + exists);
		if(exists === false){
			logger.error('Unable to upload due to bucket not existing and unable to create bucket.');
			flatData = {
				status: 'fail',
				message : 'Unable to upload due to bucket not existing and unable to create bucket.'
			};
			returnData.push(flatData);
			form.destroy();
		} else {
			await client.putObject(subjectId, newGUID, part, metaData, function(err, etag) {
				if(err) {
					logger.error('err: ' + err);
					flatData = {
						status: 'fail',
						message : 'Exception at client.putObject()',
						error: err
					};
					returnData.push(flatData);
					form.destroy();
				}
				logger.debug('Etag: ' + etag);
			})

			flatData = {
				status : 'success',
				mimeType: contentType,
				href: buildHRef(req.protocol, subjectId, newGUID),
				field : part.name,
				fileName: part.filename,
				size: part.byteOffset,
				resourceId: newGUID
			};

			returnData.push(flatData);
		}
		part.resume();
	});

	// Close emitted after form parsed
	form.on('close', function() {
		logger.debug('Closing Form');
		if(returnData.length > 1) {
			logger.debug('content size: ' + size);
			returnData = returnData.reverse().map((r) => {
				size  = size - r.size
				r.size = size;
				return r;
			}).reverse();

			res.end(JSON.stringify(returnData));
		} else {
			flatData.size = size - flatData.size;
			res.end(JSON.stringify(flatData));
		}

	});

	// Parse req
	form.parse(req);
	return;
};

const adminBucketListResult = async (req,res,next) => {
	if(req.userAccess.indexOf(process.env.AccessAdminRole) === -1){ // Make this confirgurable
		res.status(401).json({
			message: "Authorisation failed."
		});
		res.end();
		return;
	}
	let objects = await bucketObjectList(req.params.bucket);
	console.log(objects);
	let objectData = [];
	for(obj of objects){
		console.log(obj);
		let stat = await statobject(req.params.bucket, obj);
		objectData.push({"name" : obj, "stat" : stat})
	}
	res.end(JSON.stringify(objectData));

	return;
}

const adminBucketsResult = async (req,res,next) => {
	if(req.userAccess.indexOf(process.env.AccessAdminRole) === -1){ // Make this confirgurable
		res.status(401).json({
			message: "Authorisation failed."
		});
		res.end();
		return;
	}
	let buckets = await bucketList();

	res.end(JSON.stringify(buckets));

	return;
}

const adminMergeBucketsResult = async (req,res,next) => {
	if(req.userAccess.indexOf(process.env.AccessAdminRole) === -1){ // Make this confirgurable
		res.status(401).json({
			message: "Authorisation failed."
		});
		res.end();
		return;
	}
	const src = req.params.srcbucket;
	const dst = req.params.dstbucket
	logger.debug('Source: ' + src + ' Destination: ' + dst);

	logger.debug('req' + req);

	const urlPart = req.protocol + '://' + req.get('host') + '/storage/retrieve/';
	try {
		const mergeResultData = await mergeBucket(src,dst,urlPart);
		res.end(JSON.stringify(mergeResultData));
	} catch(err) {
		return res.status(500).json({
			message: 'Exception in mergeBucket',
			error: err
		});
	}




	return;
}

const testStorageEndpoint = async (req,res,next) => {
	logger.debug('testing storage');
	res.status(200).json({
		message: 'Storage Endpoint Working'
	});
};


// Routes

router.get('/test', verifyToken, asyncMiddleware(testStorageEndpoint));

router.post('/file', verifyToken, asyncMiddleware(formPutResult));
router.get('/file/:bucket/:file', verifyToken, asyncMiddleware(getFileResult));
router.get('/file/meta/:bucket/:file', verifyToken, asyncMiddleware(getFileStatResult));

router.put('/put', verifyToken, asyncMiddleware(formPutResult));

router.post('/put', verifyToken, asyncMiddleware(formPutResult));

router.get('/retrieve/:bucket/:file', verifyToken, asyncMiddleware(getFileResult));

router.get('/stat/:bucket/:file', verifyToken, asyncMiddleware(getFileStatResult));

router.get('/admin/buckets', verifyToken, asyncMiddleware(adminBucketsResult));

router.get('/admin/bucket/:bucket', verifyToken, asyncMiddleware(adminBucketListResult));

router.get('/admin/bucket/merge/:srcbucket/:dstbucket', verifyToken, asyncMiddleware(adminMergeBucketsResult));

module.exports = router;
