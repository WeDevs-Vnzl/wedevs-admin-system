# syntax=docker/dockerfile:1
# Next.js `output: "standalone"` image. bun installs; Node builds and runs (stack.md).
# Node tag must match .nvmrc (24.21.0). Build context: the repository root (`compose.yaml`).

FROM docker.io/oven/bun:1.4.2 AS deps
WORKDIR /app
# Every workspace manifest is needed for `--frozen-lockfile`; only @wedevs/web is installed.
COPY package.json bun.lock bunfig.toml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-contract/package.json packages/api-contract/
RUN bun install --frozen-lockfile --filter @wedevs/web

FROM docker.io/library/node:24.21.0-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
WORKDIR /app
COPY --from=deps /app ./
COPY packages/api-contract ./packages/api-contract
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN node_modules/.bin/next build

FROM docker.io/library/node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# The standalone tree mirrors the monorepo (apps/web/server.js plus the traced node_modules).
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
# apps/web has no public/ directory; copy it here if one is ever added.
USER node
EXPOSE 3000
# redirect: manual — `/` redirects to sign-in (Clerk); following it would make the check depend on the network.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/', { redirect: 'manual' }).then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
