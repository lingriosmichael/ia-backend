# Impact Atlas Backend

This service is the backend API for Impact Atlas. It is a TypeScript application built with Fastify, Mongoose, and MongoDB. It powers authentication, organizations, projects, activities, uploads, and the core grant-management workflows.

## What this service does

- Handles user registration and login
- Manages organizations, memberships, projects, and activities
- Stores data in MongoDB
- Exposes a REST API for the frontend application
- Supports file upload metadata and processing workflows

## Prerequisites

Before you start, make sure you have the following installed on your computer:

- Git
- Node.js 22.12.0 or newer (preferably the current Node 22 LTS release)
- npm (this comes with Node.js)
- Docker Desktop
- A terminal app such as Terminal or iTerm
- VS Code (recommended)

### macOS setup example

If you are on macOS and do not already have Node.js or Homebrew installed, use the following commands:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Then confirm the installation:

```bash
node --version
npm --version
docker --version
docker compose version
```

> Docker Desktop must be running before you start MongoDB.

## Clone the repository

```bash
git clone <your-repo-url>
cd Impact_Atlas/ia_backend
```

## Install dependencies

```bash
npm install
```

## Create the environment file

```bash
cp .env.example .env
```

Open the new .env file and review the values. The defaults are usually enough for local development.

## Start The Full Local Stack With Docker

Copy both environment files first:

```bash
cp .env.example .env
cp ../ia_python_service/.env.example ../ia_python_service/.env
```

The shared secret must match across both services:

```env
# ia_backend/.env
PYTHON_SERVICE_SHARED_SECRET=replace-with-a-long-random-secret

# ia_python_service/.env
INTERNAL_SERVICE_TOKEN=replace-with-a-long-random-secret
```

Then start MongoDB, the backend API, the backend analytics worker, the Python API, and the Python worker:

```bash
docker compose up --build
```

This now runs:

- MongoDB on `localhost:27017`
- MinIO object storage on `http://localhost:9000`
- MinIO console on `http://localhost:9001`
- Backend on `http://localhost:4000`
- Backend analytics worker as a separate managed process
- Python API on `http://localhost:8000`
- Python background worker as a separate managed process

## Start MongoDB Only

If you only want MongoDB and prefer running the services manually:

```bash
docker compose up -d mongo
```

This starts a local MongoDB container on port 27017.

If this is your first time running it, Docker may take a few minutes to download the image.

## Start the backend locally

```bash
npm run dev
```

The API should now be available at:

- http://localhost:4000
- Health check: http://localhost:4000/health

## Start the backend analytics worker locally

In a second terminal:

```bash
npm run dev:analytics-worker
```

This worker claims queued analytics executions from MongoDB, renews leases while
they run, and continues processing independently of the API request lifecycle.

## Start the Python services locally

In a third terminal:

```bash
cd ../ia_python_service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
make run-api
```

In a fourth terminal:

```bash
cd ../ia_python_service
source .venv/bin/activate
make run-worker
```

## Useful commands

```bash
npm run dev      # start the development server
npm run build    # compile the TypeScript app
npm run lint     # type-check the project
npm run test     # run tests
```

## Stop the services

To stop the MongoDB container:

```bash
docker compose down
```

To stop the full Docker stack:

```bash
docker compose down
```

## Common troubleshooting

- If the server does not start, make sure Docker Desktop is open and running.
- If MongoDB fails to connect, confirm the database container is running with `docker compose ps`.
- If processing jobs stay queued, confirm the `python-worker` container or `make run-worker` process is running.
- If analytics generations stay queued, confirm the `analytics-worker` container or `npm run dev:analytics-worker` process is running.
- If you see a port error, check whether port 4000 is already being used by another app.
- If the app cannot connect to the frontend, confirm the backend is running and that `CORS_ORIGIN` in `.env` matches the frontend address.
- If the server crashes immediately on startup with a `MAILERSEND_API_TOKEN is required` error, either set `EMAIL_PROVIDER=disabled` (the `.env.example` default, no real email sending) or fill in a real `MAILERSEND_API_TOKEN`.

## Environment variables

The default values are already provided in .env.example:

- API_PORT: the local port for the backend
- JWT_SECRET: secret used to sign authentication tokens
- JWT_EXPIRES_IN: token lifetime
- AUTH_COOKIE_NAME: name of the httpOnly session cookie
- AUTH_COOKIE_SAME_SITE: `lax` for same-site local dev, `none` once the frontend and this API are on different sites (requires HTTPS) — see `sessionCookie.ts` for why this matters
- AUTH_COOKIE_SECURE: optional override; defaults to `true` in production and `false` locally
- CORS_ORIGIN: allowed frontend origin
- WEBAPP_URL: frontend base URL used in invitation links
- PYTHON_SERVICE_URL: URL for the Python service if you use it
- PYTHON_SERVICE_SHARED_SECRET: shared secret sent as `x-internal-service-token`; must exactly match `ia_python_service`'s `INTERNAL_SERVICE_TOKEN`
- PYTHON_SERVICE_TIMEOUT_MS: timeout for ordinary backend-to-Python requests
- PYTHON_ANALYTICS_TIMEOUT_MS: longer timeout for analytics curation requests
- FILE_STORAGE_DRIVER: `local` for development or `s3` for shared object storage
- UPLOAD_DIR: where upload files are stored locally
- S3_ENDPOINT: object storage endpoint when using `FILE_STORAGE_DRIVER=s3`
- S3_REGION: storage region when using `FILE_STORAGE_DRIVER=s3`
- S3_BUCKET: shared bucket name when using `FILE_STORAGE_DRIVER=s3`
- S3_ACCESS_KEY_ID: object storage access key
- S3_SECRET_ACCESS_KEY: object storage secret key
- S3_KEY_PREFIX: optional folder prefix inside the bucket
- S3_FORCE_PATH_STYLE: optional toggle for path-style S3 URLs
- MONGODB_URI: MongoDB connection string
- MONGODB_DB_NAME: database name
- EMAIL_PROVIDER: `disabled` or `mailersend`
- EMAIL_FROM: verified MailerSend sender email
- EMAIL_FROM_NAME: sender name shown in invitation emails
- EMAIL_REPLY_TO: optional reply-to email
- EMAIL_REPLY_TO_NAME: optional reply-to name
- MAILERSEND_API_BASE_URL: MailerSend API base URL
- MAILERSEND_API_TOKEN: MailerSend API token
- AI_PROVIDER: local AI provider mode
- AI_MODEL: AI model name

## Production Storage Recommendation

For real multi-instance deployment, keep `FILE_STORAGE_DRIVER=local` only for local development.
For production, set:

```env
FILE_STORAGE_DRIVER=s3
S3_ENDPOINT=https://your-object-storage-endpoint
S3_REGION=eu-central-1
S3_BUCKET=impact-atlas-production
S3_ACCESS_KEY_ID=replace-me
S3_SECRET_ACCESS_KEY=replace-me
S3_KEY_PREFIX=backend-assets
S3_FORCE_PATH_STYLE=true
```

The backend now treats local disk storage as a production misconfiguration.
If `NODE_ENV=production`, it requires `FILE_STORAGE_DRIVER=s3` unless you
explicitly set `ALLOW_LOCAL_FILE_STORAGE_IN_PRODUCTION=true`.

## Local S3 Verification With MinIO

To verify shared object storage locally, update `ia_backend/.env` to:

```env
FILE_STORAGE_DRIVER=s3
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=impact-atlas-local
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_KEY_PREFIX=backend-assets
S3_FORCE_PATH_STYLE=true
```

Then start the verification stack:

```bash
docker compose --profile storage-verification up --build
```

This gives you:

- the main backend on `http://localhost:4000`
- a second backend replica on `http://localhost:4001`
- both backends pointed at the same MongoDB and MinIO bucket
- no shared local upload volume on the replica, so local-disk storage would fail there by design

Run this verification sequence:

1. Create or update an organization logo through the normal app flow on port `4000`.
2. Fetch the same logo through both `http://localhost:4000/organizations/:organizationId/logo` and `http://localhost:4001/organizations/:organizationId/logo`.
3. Upload evidence through the app on port `4000`.
4. Download the same evidence file through both backends and confirm the file is readable from `4001`.
5. Start an evidence-processing or interpretation job, then run `docker compose restart backend python-worker`.
6. Confirm the job completes after the services come back and that the uploaded source file is still readable.

Expected result:

- with `FILE_STORAGE_DRIVER=s3`, both backends and the worker can continue reading the same files
- with `FILE_STORAGE_DRIVER=local`, the replica on port `4001` should not be able to read files written by the main backend

## MVP Deployment On Render

For the lowest-risk MVP setup this repo should be deployed as two Render
services from the same repository:

- one web service for `ia_backend`
- one background worker for `analytics-worker`

This repository now includes [render.yaml](render.yaml), which defines both services.

Recommended MVP constraints:

- keep `numInstances: 1` for the backend web service
- attach a persistent disk and keep `UPLOAD_DIR=/opt/render/project/src/uploads`
- set `FILE_STORAGE_DRIVER=local`
- set `ALLOW_LOCAL_FILE_STORAGE_IN_PRODUCTION=true`
- do not scale the backend horizontally until uploads move to shared object storage

Recommended production-facing values:

```env
NODE_ENV=production
PORT=10000
API_PORT=10000
CORS_ORIGIN=https://app.your-domain.com
WEBAPP_URL=https://app.your-domain.com
MONGODB_URI=<mongodb-atlas-uri>
PYTHON_SERVICE_URL=<render-private-python-url>
PYTHON_SERVICE_SHARED_SECRET=<shared-secret>
FILE_STORAGE_DRIVER=local
ALLOW_LOCAL_FILE_STORAGE_IN_PRODUCTION=true
UPLOAD_DIR=/opt/render/project/src/uploads
```

Notes:

- `src/server.ts` now honors Render's injected `PORT` automatically.
- `/health` is the Render health check path.
- the analytics worker should remain a separate Render background worker, not part of the web service process.

That lets every backend replica read the same evidence files and organization logos instead of depending on one machine's disk.

## Invitation email setup

Invitation emails now support MailerSend's Email API. To send real invitation emails, set:

```env
EMAIL_PROVIDER=mailersend
WEBAPP_URL=http://localhost:8080
EMAIL_FROM=hello@your-domain.com
EMAIL_FROM_NAME=Impact Atlas
MAILERSEND_API_TOKEN=your-mailersend-api-token
```

The `EMAIL_FROM` address must be a verified sender identity or belong to a verified domain in MailerSend.
After that, organization invitations will email the acceptance link automatically.
