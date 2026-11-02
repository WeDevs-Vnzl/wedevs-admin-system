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
bun run test:int         # adapter tests (starts its own Postgres container)
bun run test:e2e         # Supertest e2e (starts its own Postgres container)
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

### BE-4 environment

Required, at least 32 characters each (the app refuses to start naming only the variable): `SHARE_IP_SALT`
(salt of the stored share-access IP hash) and `SHARE_UNLOCK_SECRET` (signs the portal unlock cookie).
Optional: `THROTTLE_TTL` (seconds, default 60), `THROTTLE_LIMIT` (requests per window, default 60) and
`TRUST_PROXY_HOPS` (reverse proxies in front of the API, default 0; set 1 behind Caddy so `req.ip` is the
real client, DT-143). Request logs mask the share token (`/portal/<token>`).

### BE-5 environment

`REDIS_URL` (for example `redis://localhost:6379`) is optional for the API, which never connects to Redis
(DT-169), and required by the worker (`node dist/worker.js`): it refuses to start without it, naming only the
variable. Add it to your local, uncommitted env file if you run the worker outside compose; the compose
`worker` service sets `redis://redis:6379` itself.

The worker validates its own, smaller environment (`workerEnvSchema`, DT-191): `NODE_ENV`, `APP_URL`,
`DATABASE_URL`, `REDIS_URL` (required), `SENTRY_DSN` (optional), the three `CLOUDINARY_*` names, `SHARE_IP_SALT`,
`SHARE_UNLOCK_SECRET` and the optional integration pairs below. It needs no `CLERK_*` variable and refuses to
start naming only the missing or invalid variables.

### BE-6 environment (optional integrations)

Each pair is all-or-nothing: setting one name of a pair without the other makes the process refuse to start,
naming the missing variable. With no pair set the integration is off.

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Binance (read-only API key): `BINANCE_API_KEY`, `BINANCE_API_SECRET`.

There is no bank variable (the bank adapter is deferred, DT-186). Add them to your local, uncommitted env file
only when you need the integration; tests use fakes and never call Stripe or Binance.

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
systemctl --user start podman.socket   # podman-only machines; Docker works as is
bun run test && bun run test:int && bun run test:e2e
```

## Integration and e2e databases (DT-117)

`test:int` and `test:e2e` need no running database and ignore any `DATABASE_URL` in your env. Each project run
starts one throwaway `postgres:17` with Testcontainers, migrates and seeds a template database once, and gives
every spec file its own database cloned from it (`test/support/global-setup.ts`, `test/support/spec-database.ts`),
so spec files run in parallel. On a podman-only machine the setup points Testcontainers at the rootless podman
socket and disables Ryuk itself; set `DOCKER_HOST` to override. The container is stopped when the run ends.

`bun run db:reset` / `db:seed` still need a local podman Postgres in `DATABASE_URL` for running the app.
