# syntax=docker/dockerfile:1
# Multi-stage image (DT-90). bun is only the package manager/build tool; the runtime is Node (stack.md).
# Node tag must match .nvmrc (24.21.0). Build context: the repository root (`compose.yaml`).

FROM docker.io/oven/bun:1.4.2 AS manifests
WORKDIR /app
# Every workspace manifest is needed for `--frozen-lockfile`; only @wedevs/api is installed.
COPY package.json bun.lock bunfig.toml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-contract/package.json packages/api-contract/

FROM manifests AS deps
RUN bun install --frozen-lockfile --filter @wedevs/api

FROM manifests AS prod-deps
RUN bun install --frozen-lockfile --production --filter @wedevs/api

FROM deps AS build
WORKDIR /app/apps/api
COPY apps/api/nest-cli.json apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/prisma.config.ts ./
COPY apps/api/prisma ./prisma
COPY apps/api/src ./src
# `prisma generate` never connects to a database (no DIRECT_URL needed here).
RUN bunx prisma generate && bunx nest build

FROM docker.io/library/node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
# Isolated linker: apps/api/node_modules links into the store under the root node_modules/.bun.
COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules /app/apps/api/node_modules
WORKDIR /app/apps/api
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
# Schema + migrations + config: what `prisma migrate deploy` needs (the `migrate` compose service).
COPY --chown=node:node apps/api/package.json apps/api/prisma.config.ts ./
COPY --chown=node:node apps/api/prisma ./prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/main.js"]
