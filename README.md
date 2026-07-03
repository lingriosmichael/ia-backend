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

## Start MongoDB with Docker

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

## Common troubleshooting

- If the server does not start, make sure Docker Desktop is open and running.
- If MongoDB fails to connect, confirm the database container is running with `docker compose ps`.
- If you see a port error, check whether port 4000 is already being used by another app.
- If the app cannot connect to the frontend, confirm the backend is running and that `CORS_ORIGIN` in `.env` matches the frontend address.

## Environment variables

The default values are already provided in .env.example:

- API_PORT: the local port for the backend
- JWT_SECRET: secret used to sign authentication tokens
- JWT_EXPIRES_IN: token lifetime
- CORS_ORIGIN: allowed frontend origin
- WEBAPP_URL: frontend base URL used in invitation links
- PYTHON_SERVICE_URL: URL for the Python service if you use it
- UPLOAD_DIR: where upload files are stored locally
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
