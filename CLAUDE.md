# gr_backend — API Service

Stack: Node.js, TypeScript, Fastify, Mongoose, MongoDB, JWT auth.

## Structure

(Adjust this section to match reality as the codebase grows — keep it a
truthful map, not an aspiration.)

- `src/modules/<domain>/` — domain modules such as `organization`, `project`, `activity`, `upload`
- `src/modules/<domain>/*Controller.ts` — request/response coordination
- `src/modules/<domain>/*Routes.ts` — Fastify route registration
- `src/modules/<domain>/*Service.ts` — business logic
- `src/modules/<domain>/*Repository.ts` — repository contracts
- `src/modules/<domain>/*MongoRepository.ts` — Mongo data access
- `src/modules/<domain>/*Model.ts` — Mongoose schemas/models
- `src/modules/<domain>/*Persistence.ts` — persistence record/input types
- `src/shared/` — cross-cutting infrastructure such as auth, bootstrap, database, errors, http
- `src/schemas/` — request validation schemas
- `src/scripts/` — explicit maintenance/migration scripts

## Layering rule

Routes → controllers → services → repositories. Controllers never call
Mongo/Mongoose directly; services never touch `req`/`res`. This keeps business logic
testable independent of Fastify and keeps DB access in one place.

## Naming standard

- Use `camelCase` for all multi-word backend source filenames.
- Use suffix-based filenames such as `organizationService.ts`, `organizationController.ts`, `organizationRoutes.ts`, `organizationMongoRepository.ts`.
- Tests use `camelCase.test.ts`.
- Type declaration files may keep the `.d.ts` suffix, e.g. `fastify.d.ts`.
- Do not introduce kebab-case backend source filenames.
- Keep folder names as lower-case domain nouns unless there is a strong reason to do otherwise.

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
Keep file names predictable enough that the role of a file is obvious from its name alone.
