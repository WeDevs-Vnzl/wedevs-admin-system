# wedevs-be

NestJS hexagonal backend. Commands only (run with bun, runtime is Node 24):

```
bun install --frozen-lockfile
bun run build            # nest build -> dist/
bun run start            # node dist/main.js
bun run start:dev        # nest start --watch
bun run lint             # eslint (incl. layer boundary rules)
bun run format           # prettier --write
bun run typecheck        # tsc --noEmit
bun run test             # unit project
bun run test:int         # adapter tests (needs local Postgres)
bun run test:e2e         # Supertest e2e (needs local Postgres)
bun run test:cov         # unit + coverage thresholds
bun run prisma:generate
bun run db:migrate       # prisma migrate dev
bun run db:reset         # prisma migrate reset --force (runs seed)
bun run db:seed
bun run openapi:generate
bun run openapi:check
```

Copy `.env.example` to a local env file and fill placeholders; never commit it.

### BE-1 environment (required)

The app refuses to start (exit non-zero, names only, never values) unless these are set and non-empty:
`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY` (PEM public key for networkless JWT
verification), `CLERK_WEBHOOK_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`.

The project owner provisions the real values in the Clerk and Cloudinary dashboards and keeps them in a
local, uncommitted env file or the deploy environment. Agents never read, request or print them. Tests, CI
and `openapi:generate`/`openapi:check` use documented placeholders only and never call Clerk or Cloudinary.

### Clerk sign-up mode

The Clerk instance must use **Restricted** sign-up mode (invitation only, HU-01 CA1). With open sign-up an
uninvited person who registers fires `user.created` and is mirrored locally as a `VIEWER`.

## OpenAPI contract

`packages/api-contract/openapi.json` (OpenAPI 3.1, package `@wedevs/api-contract`) is generated from
the code and committed; `apps/web` generates its `schema.d.ts` from it.

```
bun run openapi:generate   # rewrite packages/api-contract/openapi.json deterministically
bun run openapi:check      # fails with a short diff when the committed file is stale
```

Drift procedure: after any controller, DTO or schema change, run `bun run api:gen` from the repo root
(it regenerates the contract, then `apps/web/src/lib/api/schema.d.ts`), review the diff and commit both
together with the code. CI runs `openapi:check`. In non-production the
live document is also served at `GET /api/openapi.json`.

## Fresh clone

```
bun install --frozen-lockfile
bun run prisma:generate          # src/generated is gitignored
# local podman Postgres (never a remote database), then set DATABASE_URL/DIRECT_URL in your local env
bunx prisma migrate deploy && bun run db:seed
bun run test && bun run test:int && bun run test:e2e
```
