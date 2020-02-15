# HealthStorage
##  Introduction
This is a gaetway service to sit in front of MinIO Server to provide and has been built to exist alongside and OpenEHR platform, although could work with other systems. Objects can be submiteed via PUT or POST and the service will ofuscate the name and store the file in a bucket based on the supplied subject ID. On succesful storage of the object it will return the URL to retrieve the Object. 

## Limitations
This service does hold any form of index this is the role of the system using this service.
This service accepts JWT tokens but only verifies the token is valid and the relevant claims exist.
There is no per file security mechanism, this should be handle upstream of this service if required.

## Prerequisites
* [NodeJS](https://nodejs.org/)

## Installation
    $ npm install
    $ cp ./src/.env.TEMPLATE ./src/.env.devlopement
    $ vim ./src/.env.devlopement

Update config with appropriate values:

    #Service
    listenOn=8080
    cacheDirectory=/tmp/.cache

    #OpenID Connect Endpoint
    openIDDirectAccessEnpoint=https://keycloak/auth/realms/realm/protocol/openid-connect/token
    openIDClientID=client
    openIDClientSecret=
    jwksUri='https://openidserver/openid-connect/certs'
    AccessClaimPath=accessclaim
    AccessReadRole=ROLE_READ
    AccessWriteRole=ROLE_WRITE
    AccessAdminRole=ROLE_ADMIN
    
    #CORS
    corsEnabled=true
    allowedOrigins='http://example1.com','http://example2.com'

    #MinIO
    MinIO_endPoint='play.min.io'
    MinIO_port=9000
    MinIO_useSSL=true
    MinIO_accessKey='Q3AM3UQ867SPQQA43P2F'
    MinIO_secretKey='zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG'

## Launch
#### Dev
    $ npm run dev
#### Production
    $ npm run start
## Usage
  All endpoints other than the login endpoint require a JWT with the relevant role. The service uses a subeject ID to provide logical seperation. This is intended when using with OpenEHR that this is the EHR ID.
  
#### Login
    curl --request POST \
          --url http://localhost:8080/auth/login \
          --header 'content-type: application/json' \
          --header 'origin: http://example1.com' \
          --data '{
            "username" : "username",
            "password" : "password!"
        }'
 
#### Add Files
    curl --request POST \
        --url http://localhost:8080/storage/put \
        --header 'authorization: Bearer <token>' \
        --header 'content-type: multipart/form-data;' \
        --header 'origin: http://example1.com' \
        --form subjectId=<subjectId> \
        --form file1=<file> \
        --form file2=<file>

#### Get File
    curl --request GET \
      --url http://localhost:8080/storage/retrieve/<subjectId>/<fileId> \
      --header 'authorization: Bearer <token>' \
      --header 'origin: http://example1.com'

#### Admin
##### Get Buckets
    curl --request GET \
    --url http://localhost:8080/storage/admin/buckets \
    --header 'authorization: Bearer <token>' \
    --header 'origin: http://example1.com'
##### Get Bucket Contents
    curl --request GET \
      --url http://localhost:8080/storage/admin/bucket/<subjectId>/ \
      --header 'authorization: Bearer <token>' \
      --header 'origin: http://example1.com'
##### Merge Buckets
    curl --request GET \
      --url http://localhost:8080/storage/admin/bucket/merge/<src>/<dst> \
      --header 'authorization: Bearer <token>' \
      --header 'origin: http://example1.com'
