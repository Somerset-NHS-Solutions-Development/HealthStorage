const jwt = require('jsonwebtoken')
const verifyToken = require('./verify-token');
const fs = require("fs");
const express = require('express');
const multiparty = require('multiparty');
const router = express.Router()
const uuidv4 = require('uuid/v4');
const Minio = require('minio')
const mime = require('mime');

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
    secretKey: process.env.MinIO_secretKey
})

// Functions

function makeBucket(name, region = '') {
	return new Promise(function(resolve, reject){
		try {
			client.makeBucket(name, region, function(err) {
				if (err) {
					console.log(err);
					resolve(false);
				}
				
				if(region === '') {
					region = 'Default';
				}
				console.log('Bucket created successfully in '+region+'.');
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
				console.log(err)
				reject(err);
			}
			console.log(stat);
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
			console.log(srcfile);
			const fileStream = fs.createReadStream(srcfile)
			const fileStat = fs.stat(srcfile,async function(err, stats) {
				if (err) {
				return console.log(err)
				}
				await client.putObject(bucket, dstfile, fileStream, stats.size, metaData, function(err, etag) {
					if(err) {
						console.log(err);
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
			if(process.env.cacheDirectory){
				let tmpFile = String(process.env.cacheDirectory)+'\\'+file;
				
				if(process.platform === "win32"){
					tmpFile = tmpFile.replace('/','\\');
				} else {
					tmpFile = tmpFile.replace('\\','/');
				}
				// console.log(tmpFile);
				const fileStream = fs.createWriteStream(tmpFile);
				
				client.getObject(bucket, file, function(err,dataStream) {
					if (err) {
						fileStream.destroy();
						reject(err);
					}
					fileStream.on('error', ()=>{
						dataStream.destroy();
						reject();
					});
					dataStream.on('data', function(chunk) {
						// size += chunk.length
					})
				  
					dataStream.on('end', function() {
						//console.log('End. Total size = ' + size)
						resolve(tmpFile);
					})
					dataStream.on('error', function(err) {
						fileStream.destroy();
						reject(err);
					})
					dataStream.pipe(fileStream);
				});
				
				resolve(tmpFile);
				
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
			let objectsStream = client.listObjectsV2(bucket,'', true,'');		
			objectsStream.on('data',async function(obj) {	
				objects.push(obj.name)
			})
			objectsStream.on('error', function(err) {
				console.log(err)
				reject(err);
			})		
			objectsStream.on('end', function() {
				resolve(objects);
				
			});
		} catch(err) {
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

function mergeBucket(src,dst,urlPart) {
	return new Promise(async (resolve, reject) => {
		try{
			let returnData = [];
			const srcFiles = await bucketObjectList(src);
			console.log(srcFiles);
			for(file of srcFiles){
				console.log('File: '+file);
				const fileInfo = await statobject(src,file);
				if(fileInfo){
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
					let exists = await checkBucketExists(dst);
					if(exists === false){
						await makeBucket(dst, region);				
					} 
					exists = await checkBucketExists(dst);
					if(exists === false){
						reject(new Error('Unable to create bucket'));
					} else {
						const cachedFile = await getobjectToCache(src,file);
						try {
							await fs.promises.access(cachedFile);
							const url = urlPart+dst+'/'+file;
							const prevUrl = urlPart+src+'/'+file;
							/*
							await client.fPutObject(dst, file, cachedFile, metaData, function(err, etag) {
							  console.log(err, etag) // err should be null
							})
							*/
							
							const etag = await putFileObject(dst,file,cachedFile,metaData);
							
							const dstfileInfo = await statobject(dst,file);
							
							if(dstfileInfo){
								fs.unlink(cachedFile, (err) => {
									if (err) throw err;
									console.log(cachedFile+' was deleted');
									
								);
								
								await client.removeObject(src, file, function(err) {
									if (err) throw err;
								})
								
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
			console.log(err)
			res.status(500).json(err);
			return res.end();
		}
		res.end(JSON.stringify(stat));
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
			//return console.log(err)
			res.status(500).json(err);
			return res.end();
		  }
		  dataStream.on('data', function(chunk) {
			if(chunk){
				miniData.push(chunk);
				size += chunk.length				
			}			
		  })
		  dataStream.on('end', function() {
			res.end(Buffer.concat(miniData));
			// console.log('End. Total size = ' + size)			
		  })
		  dataStream.on('error', function(err) {
			//console.log(err)
			res.status(500).json(err);
			return res.end();
		  })
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
		});
		res.end();
		return;
	}
	const form = new multiparty.Form();
	let count = 0;
	let fileMetadata = {};
	let subjectId = '';
	let returnData = [];
	
	
	form.on('error', function(err) {
	  res.status(500).json(err);
	  return res.end();
	});
	
	form.on('field', function(name, value) {
		if(name === 'metadata') {
			fileMetadata = value;
		}
		if(name === 'subjectId') {
			subjectId = value;
		}
    });

	// Parts are emitted when parsing the form
	form.on('part', async function(part) {
		// You *must* act on the part by reading it, if you want to ignore it, just call "part.resume()"
		if (!part.filename) {
			// filename is not defined when this is a field and not a file
			part.resume();
		}
		if (part.filename) {
			// filename is defined when this is a file
			count++;
			const fileExt = part.filename.split('.').pop();
			let contentType = mime.getType(fileExt);
			if(typeof contentType === "undefined"){
				contentType = 'application/octet-stream';
			}
			const metaData = {
				'Content-Type': contentType,
				'SubjectId': subjectId
			};
			
			
			const newGUID = uuidv4();
			const url = req.protocol + '://' + req.get('host') + '/storage/retrieve/'+subjectId+'/'+newGUID;
			const region = '';
			
			let exists = await checkBucketExists(subjectId);
			if(exists === false){
				await makeBucket(subjectId, region);				
			} 
			exists = await checkBucketExists(subjectId);
			if(exists === false){
				console.log('Unable to upload due to bucket not existing and unable to create bucket.')
				returnData.push({
					status : 'failed',
					field : part.name,
					filename : part.filename,
					error: 'Unable to upload due to bucket not existing and unable to create bucket.'
				});
			} else {
				await client.putObject(subjectId, newGUID, part, metaData, function(err, etag) {
				  console.log(err, etag) // err should be null
				})
				returnData.push({
					status : 'success',
					field : part.name,
					fileName : part.filename,
					href : url,
					mimeType : contentType
				});
			}			
			part.resume();
		}

		part.on('error', function(err) {
			res.status(500).json(err);
			return res.end();			
		});
	});

	// Close emitted after form parsed
	form.on('close', function() {
		res.end(JSON.stringify({'subjectId':subjectId,'files':returnData}));
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
	console.log('Source: ' + src + ' Destination: ' + dst);
	const urlPart = req.protocol + '://' + req.get('host') + '/storage/retrieve/';
	const mergeResultData = await mergeBucket(src,dst,urlPart);
	
	res.end(JSON.stringify(mergeResultData));  	
	
	return;
}


// Routes

router.put('/put', verifyToken, asyncMiddleware(formPutResult));

router.post('/put', verifyToken, asyncMiddleware(formPutResult));

router.get('/retrieve/:bucket/:file', verifyToken, asyncMiddleware(getFileResult));

router.get('/stat/:bucket/:file', verifyToken, asyncMiddleware(getFileStatResult));

router.get('/admin/buckets', verifyToken, asyncMiddleware(adminBucketsResult));

router.get('/admin/bucket/:bucket', verifyToken, asyncMiddleware(adminBucketListResult));

router.get('/admin/bucket/merge/:srcbucket/:dstbucket', verifyToken, asyncMiddleware(adminMergeBucketsResult));

module.exports = router;