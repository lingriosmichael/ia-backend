# gr_backend — API Service

Stack: Node.js, TypeScript, Fastify, Mongoose, MongoDB, JWT auth.

## Structure

(Adjust this section to match reality as the codebase grows — keep it a
truthful map, not an aspiration.)

- `src/routes/` — route definitions only, no logic
- `src/controllers/` — request/response handling, calls services
- `src/services/` — business logic, framework-agnostic
- `src/modules/*/*.mongo-repository.ts` — Mongo data access
- `src/modules/*/*.model.ts` — Mongoose schemas/models

## Layering rule

Routes → controllers → services → repositories. Controllers never call
Mongo/Mongoose directly; services never touch `req`/`res`. This keeps business logic
testable independent of Fastify and keeps DB access in one place.

## Validation & types

- Validate every request body and query param with a schema library (Zod is
  a good default) before it reaches a service. Don't trust `req.body`.
- No `any`. If a persistence return type doesn't quite match what a route needs,
  shape it explicitly rather than casting.

## Auth

- JWT verified in middleware, not repeated per-route.
- `JWT_SECRET` only ever comes from `.env` — never hardcoded, never logged.
- Keep token expiry (`JWT_EXPIRES_IN`) sane for your threat model; 7 days is
  fine for early dev, reconsider before real users.

## Database

- Keep Mongoose models and repository record shapes in sync.
- Prefer explicit schema fields and indexes over implicit document shape drift.
- If a document shape changes, update both the model and any contract mapper in the same change.

## API design

- RESTful resource naming: `/api/projects/:id`, not `/api/getProject`.
- Consistent response shape across endpoints, e.g. `{ data }` on success,
  `{ error }` on failure — pick one and use it everywhere.
- Version routes (`/api/v1/...`) once you have external consumers or expect
  breaking changes; not urgent while it's just `gr_webapp` calling in.

## Error handling

- One centralized error-handling middleware. Don't let raw database errors
  reach the client — catch, log server-side, return a clean
  error shape.

## Environment variables

- Validate required env vars at startup and fail fast with a clear message
  if one is missing, rather than failing confusingly at request time.

## Testing

Light, by design — no coverage mandate. The one carve-out: auth endpoints
and anything destructive (deletes, payments, irreversible state changes)
should have at least a minimal smoke test before you ship changes to them.
Always test against a dedicated test database, never dev data.

## Security baseline

- `CORS_ORIGIN` matches the real frontend origin exactly; no wildcard once
  live.
- Sanitize input reaching database queries and avoid passing unchecked user
  values into dynamic query construction.
- Rate-limit login/auth endpoints.

## Commands

```
npm run dev              # start with hot reload
docker compose up -d mongo
```

## Backend philosophy

Routes should not contain business logic.
Controllers should coordinate.
Services should implement business rules.
Repositories should only access persistence.
