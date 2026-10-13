# Stack and versions

Source: PRD §6.2 (technical decisions), §6.3 (folders), §6.5 (environments), §14 (quality, CI), as
amended by the user decisions recorded in `decisions.md` (DU-01, DU-02, DT-07 revised by OP-01, DT-33,
OP-02, OP-03, OP-06). The stack is **decided**; it is not up for debate in any batch. A batch that needs
something outside this list raises a blocking question to the user.

Delivery order follows **DU-01** (two milestones): Hito 1 builds the complete UI over a mock layer;
Hito 2 replaces the mocks with the real backend. The column "Installed in" tells which milestone adds
each dependency.

## Platform agnosticism (user decision, OP-01)

The system is **database-platform agnostic**. Postgres is reached only through a connection string with
the plain `pg` driver adapter; there is **no Neon adapter and no Neon-specific code path**. Neon (or any
other host) is just a Postgres server. Likewise, file storage is reached only through the generic S3 API
behind `StorageProvider`. Changing provider = changing environment variables.

## Version policy

- **Exact pins.** `.npmrc` sets `save-exact=true`; `package.json` never carries `^` or `~`. The exact
  versions live in `package.json` + `pnpm-lock.yaml`; this file fixes the **major line** and the rules.
- Where this file says **"pin in scaffold"**, the scaffold package (H1-B1, package 1.1) picks the latest
  stable release of the stated major at the time it runs, verifies compatibility with the rest of the
  stack, and pins it exactly. It reports the chosen versions in its `worker_done`. Versions are not
  guessed in this file.
- Upgrading a major is a change batch with its own package (it changes the lockfile).
- Only one package per wave changes `package.json`/`pnpm-lock.yaml` (`phase-gates.md` rule 10,
  `safeguards.md` rule 7).

## Runtime and tooling

| Item | Decision | Pin |
|---|---|---|
| Node | Active LTS line **24.x** | Exact version in `.nvmrc` (pin in scaffold) |
| Package manager | **pnpm 10.x** through corepack | `"packageManager": "pnpm@10.x.y"` (pin in scaffold) |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` | pin in scaffold (5.x) |
| Lint / format | ESLint (flat config, `eslint-config-next`) + Prettier (+ `prettier-plugin-tailwindcss`) | pin in scaffold |
| Unit / service tests | Vitest + `@vitest/coverage-v8`, `@testing-library/react`, `jsdom` | pin in scaffold |
| E2E | Playwright (`@playwright/test`, Chromium only) | pin in scaffold |
| Script runner | `tsx` (seed, scripts) | pin in scaffold |

## Application stack

| Area | Decision | Package(s) | Installed in |
|---|---|---|---|
| Framework | Next.js **16.x** App Router, RSC, Server Actions; request interception file is **`proxy.ts`** (Next.js 16 naming; replaces `middleware.ts`, DT-33) | `next`, `react`, `react-dom` (React 19.x) | H1-B1 (exact 16.x pin in scaffold) |
| UI | shadcn/ui + Tailwind CSS + lucide-react | `tailwindcss` 4.x, `@tailwindcss/postcss`, `lucide-react`, `shadcn` CLI as an exact-pinned devDependency | H1-B1 |
| Forms | react-hook-form + Zod via `@hookform/resolvers` | `react-hook-form`, `@hookform/resolvers`, `zod` (4.x) | H1-B1 |
| Tables | TanStack Table, shadcn *data-table* pattern, server pagination | `@tanstack/react-table` | H1-B1 |
| URL state | `nuqs` | `nuqs` | H1-B1 |
| ORM | Prisma 7 (`prisma-client` generator, `prisma.config.ts`) with **`@prisma/adapter-pg` in every environment** (local, CI, production) | `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg` | H2-B1 |
| Database | PostgreSQL 17 with `pg_trgm` and `unaccent`. Production/preview host: Neon (a plain Postgres to the app). Local: `postgres:17` in podman | — | H2-B1 |
| Files | S3-compatible object storage (Neon Object Storage today) behind `StorageProvider` | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `file-type` (magic bytes) | H2-B2 |
| Uploads | Presigned URL, browser uploads straight to the bucket | (same) | H2-B2 (H1 uses a mock upload adapter) |
| Auth | Clerk (invitation only) | `@clerk/nextjs`, `svix` | H2-B2 |
| Graph | React Flow + `elkjs` (radial, layered) + `d3-force` (force); layouts in a Web Worker | `@xyflow/react`, `elkjs`, `d3-force` | H1-B1 |
| Rich text (notes) | Tiptap, stored as JSON + plain text | `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` + extensions (link, task list/item, table, image, placeholder) | H1-B1 |
| Markdown editor (documents) | CodeMirror 6, preview with `react-markdown` + `remark-gfm` + `rehype-sanitize` | CodeMirror 6 packages (`@codemirror/*` or a thin React wrapper — pick in scaffold), `react-markdown`, `remark-gfm`, `rehype-sanitize` | H1-B1 |
| PDF viewer (portal, invoice "Archivo" tab, document viewer) | **pdf.js** with a custom toolbar (page x/y, zoom, download, fullscreen) as in wireframe 4.8 (OP-06) | `pdfjs-dist` (or `react-pdf` over it — pick in scaffold); worker served from the app's own origin | H1-B1 |
| Charts | shadcn *Chart* (Recharts) | `recharts` (installed by the shadcn CLI) | H1-B1 |
| i18n | `next-intl`, locale in a cookie and in the user preference, **no route prefix** | `next-intl` | H1-B1 |
| Theme | `next-themes` (light, dark, system) | `next-themes` | H1-B1 |
| Money | Prisma `Decimal` + `decimal.js`. **Never** `float` | `decimal.js` | H1-B1 |
| Dates | Stored UTC; business dates `@db.Date`; display zone `America/Caracas` | `date-fns`, `date-fns-tz` | H1-B1 |
| Scheduled jobs | Netlify Scheduled Functions | `@netlify/functions` | H2-B6 |
| Portal rate limiting | **Netlify rate limiting** on `/s/*` and `/api/s/*` (OP-03) | none (platform feature) | H2-B5 |
| Toasts | `sonner` (shadcn) | `sonner` | H1-B1 |
| Observability | Sentry + Netlify logs | `@sentry/nextjs` | H2-B7 |
| Tests | Vitest + Playwright | see tooling | H1-B1 |

### Supporting libraries (needed by PRD features, not named in §6.2)

The scaffold installs them in H1-B1 so later Hito 1 batches do not change the lockfile. Before choosing
one, the developer checks with the shadcn MCP whether the registry already provides the component
(DU-02); a registry component always wins over a library.

| Need | Candidate | Notes |
|---|---|---|
| Drag-to-reorder project links (§8.3, HU-07 CA2) | `@dnd-kit/core`, `@dnd-kit/sortable` | |
| QR code for share links (§8.11) | `qrcode` (or `qrcode.react`) | client-side only |
| Version diff, markdown only (§8.9.3) | `diff` (jsdiff) | |
| International phone input, E.164 (§8.2) | `libphonenumber-js` (+ a registry phone-input if the MCP lists one) | |
| Country combobox with flags (§8.2) | static ISO 3166-1 list + emoji or `country-flag-icons` | |
| Technology icons by Simple Icons slug (§8.3) | `simple-icons` or `@icons-pack/react-simple-icons` | tree-shake; only slugs in use |
| PDF rendering (OP-06) | `pdfjs-dist` / `react-pdf` | see table above |
| Server-only guard | `server-only` | every module under `src/server/` |

Portal access keys (P5) are hashed with Node's built-in `crypto.scrypt` — no extra dependency.

## shadcn (DU-02)

- `components.json` is created by `shadcn init`; style, base color and CSS variables follow
  `frontend-patterns.md` § "Visual language".
- Components are added **only** with the pinned CLI: `pnpm exec shadcn add <name>` (the `shadcn`
  devDependency is exact-pinned). `npx shadcn@latest` is not used by developers.
- The shadcn MCP (`.mcp.json`, tool `mcp__shadcn`) is consulted before adding or composing a
  component (invariant **C3**).
- `.mcp.json` (user-owned) is pinned to the same `shadcn` version once the scaffold pins it (OP-05;
  task in `docs/TASK.md` H1-B1 close).

## Environments (PRD §6.5, OP-02)

| Environment | Netlify | Database | Who operates it |
|---|---|---|---|
| Production | `main` | Neon `main` branch (plain Postgres) + bucket | the user |
| Preview | one deploy preview per PR | one Neon branch per PR (DB and bucket branch together) | the user (Netlify/Neon integration) |
| CI (GitHub Actions) | — | E2E: a **Neon testing database** reached through a CI secret configured by the user; service tests: a `postgres:17` service container inside the job | GitHub runs it with the user's secret; agents only author the workflow |
| Local (agents) | `next dev` / `next start` | podman `postgres:17`, one container per worktree; optional MinIO | the worker that started it (removes it at the end) |

Environment variables (PRD §6.5, extended): `DATABASE_URL` (pooled), `DIRECT_URL`, `CLERK_*`,
`CLERK_WEBHOOK_SECRET`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`,
`STORAGE_SECRET_KEY`, `SHARE_IP_SALT`, **`SHARE_UNLOCK_SECRET`** (signs the portal unlock cookie, P5;
addition to §6.5), `SENTRY_DSN`, `APP_URL` (placeholder until a domain exists, P8). CI-only secret:
**`E2E_DATABASE_URL`** (the Neon testing DB, OP-02). Only `.env.example` (placeholder values) is
committed. Real values are placed by the user (`phase-gates.md` rule 11).

Hito 1 needs **no** environment variable to run: the mock layer replaces DB, auth and storage.

Serverless connection note: with `@prisma/adapter-pg` each function instance holds its own small `pg`
pool (max a few connections) against the pooled `DATABASE_URL`; migrations use `DIRECT_URL`.

## Netlify

- Next.js runs through Netlify's Next.js runtime (OpenNext adapter, selected automatically). The scaffold
  verifies Next.js 16 support and records it in its report.
- `netlify.toml` is root config (shared file) with `base = "fe"`. Its build command in Hito 1 is the plain `pnpm build`.
  The `prisma migrate deploy` step is added in H2-B1 (OP-02); agents never run it.
- Portal rate limiting uses Netlify's rate-limit rules (OP-03); agents may write code-based rule config
  in the repo if the user's plan supports it; the user enables and verifies it.

## Discarded approaches

| Discarded | Why |
|---|---|
| `@prisma/adapter-neon`, `@neondatabase/serverless`, any Neon-specific code path | User decision OP-01: platform-agnostic `pg` adapter everywhere (drift from PRD §6.2, recorded). |
| A separate backend (REST API, Hono/Nest/Fastify) in the MVP | PRD §3.2 (Fase 2). Services stay framework-free so extraction is cheap (§6.4). |
| Floating-point money (`number`, `parseFloat`, `toFixed` for math) | PRD §6.2, §9.1; C15. |
| A generic polymorphic `(entityType, entityId)` link table | PRD §10.1: typed nullable FKs + `CHECK num_nonnulls(...) = 1`. |
| A generic edges table for the graph | PRD §8.12.5: typed per-relation queries. |
| Route-prefixed locales (`/es/...`) | PRD §6.2: cookie + user preference, no prefix. |
| `middleware.ts` | Next.js 16 uses `proxy.ts` (DT-33). |
| Redis/Upstash or a Postgres counter for portal rate limiting | OP-03: Netlify rate limiting only (revisit only if it proves insufficient). |
| Native browser PDF embed | OP-06: pdf.js with the wireframe's custom toolbar. |
| Server-side PDF generation | PRD §3.2 (Fase 2). Browser print with a print stylesheet. |
| Email notifications | PRD §3.2 (Fase 2). Alerts are in-app only. |
| Automatic BCV rate fetching | PRD §3.2 (Fase 2). Manual entry with prefill. |
| Generic activity-log middleware | PRD §8.14: `logActivity()` called explicitly inside each service transaction. |
| Material Symbols icons (used by the HTML mockups) | PRD §6.2 mandates lucide-react; mapping in `frontend-patterns.md` §1a. |
| Hand-copied shadcn components, or hand-written components the registry provides | DU-02. |
| Sigma.js / WebGL graph in the MVP | PRD §8.12.1: only if the global graph regularly exceeds ~1,500 nodes. |
