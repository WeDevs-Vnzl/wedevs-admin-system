# syntax=docker/dockerfile:1
# Multi-stage image (DT-90). bun is only the package manager/build tool; the runtime is Node (stack.md).
# Node tag must match .nvmrc (24.21.0).

FROM docker.io/oven/bun:1.4.2 AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml .npmrc ./
RUN bun install --frozen-lockfile

FROM docker.io/oven/bun:1.4.2 AS prod-deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml .npmrc ./
RUN bun install --frozen-lockfile --production

FROM deps AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# `prisma generate` never connects to a database (no DIRECT_URL needed here).
RUN bunx prisma generate && bunx nest build

FROM docker.io/library/node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Schema + migrations + config: what `prisma migrate deploy` needs (the `migrate` compose service).
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/main.js"]
