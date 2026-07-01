# Impact Atlas Backend

`gr_backend` is the standalone TypeScript backend repository.

## Structure

```text
gr_backend/
  src/
    config/
    contracts/
    controllers/
    middleware/
    repositories/
    routes/
    schemas/
    services/
    storage/
    utils/
  .env.example
  docker-compose.yml
  package.json
  tsconfig.json
```

## Implemented

- MongoDB via Mongoose
- JWT authentication
- account registration
- login
- session lookup
- organizations and memberships
- projects
- activities
- activity uploads
- upload metadata
- processing jobs
- result records

## Accounts

Account creation is already implemented.

Endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

`POST /auth/register` creates:

- a `User`
- an `Organization`
- an owner `Membership`
- a JWT access token in the response

Request body:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "password": "strongpassword",
  "organizationName": "Example Org"
}
```

## Database Models

Core Mongo models:

- `User`
- `Organization`
- `Membership`
- `Project`
- `Activity`
- `UploadMetadata`
- `ProcessingJob`
- `ResultRecord`

## Local Development

1. Start MongoDB:

```bash
docker compose up -d mongo
```

2. Create env:

```bash
cp .env.example .env
```

3. Start the backend:

```bash
npm install
npm run dev
```

Backend default URL: `http://localhost:4000`

Health check:

- `GET /health`

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `API_PORT` | Backend HTTP port |
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | Token lifetime |
| `CORS_ORIGIN` | Allowed frontend origin |
| `PYTHON_SERVICE_URL` | Future Python microservice base URL |
| `UPLOAD_DIR` | Local uploads directory |
| `MONGODB_URI` | MongoDB server connection string |
| `MONGODB_DB_NAME` | MongoDB database name |
| `AI_PROVIDER` | Active AI provider key |
| `AI_MODEL` | Default AI model identifier |

The backend now runs directly on MongoDB. Stable string `_id` values are used across business and AI documents, and processing-job status parity includes `cancelled`.

## Deferred AI Pipeline Deepening

The reusable AI pipeline runtime is in place, but the pipeline-specific deepening work is intentionally deferred.

Reminder for later:

- give each pipeline more domain-specific preprocessing and postprocessing instead of relying on the shared provider-backed base for most behavior
- add reusable pipeline chaining so later stages can consume earlier structured outputs explicitly
- strengthen idempotency and retry behavior for queued AI executions
- move from generic result artifacts toward richer per-pipeline artifact shapes where needed
- improve report, insight, dashboard, and chat pipelines so they are meaningfully differentiated from dataset interpretation
# ia-backend
Backend Infrastructure for Impact Atlas
