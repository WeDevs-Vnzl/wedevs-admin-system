# Orca workflow — WeDevs Core (internal management system)

How this project is built with the Orca agent fleet.

- The product, architecture and binding rules live in `docs/PRD-WeDevs-Core.md` (Spanish, source of truth).
- The visual reference is `resources/wireframes/*.png` and `resources/example/*.html`.
- The operational rules for agents live in `docs/rules/` (English). The process rules (`docs/rules/ADE/`) exist from the setup; the rest of `docs/rules/` is written in batch 0 (see "Rule index").
- If `docs/rules/` and the PRD disagree, the PRD wins. Report the drift so `docs/rules/` gets fixed.

## Repo topology

One git repo, `admin-system/`, holding the Next.js monolith (PRD §6) in `fe/`, the process docs in `docs/` and visual references in `resources/`. App paths in these docs (`src/…`, `tests/…`, `prisma/…`, `package.json`) are relative to `fe/`, and every `bun` command runs inside `fe/`. Orca sessions run from the repo root; each Developer works in its own Orca worktree of this same repo.

Packages are defined by the files they touch. The folder layout is the one in PRD §6.3:

| Path | What it is | Notes |
|---|---|---|
| `prisma/` | `schema.prisma`, migrations, the complementary SQL migration (PRD §10.3), `seed.ts`, `prisma.config.ts` | The **only** place the schema changes. One owner per wave. Critical (sonnet) |
| `src/server/db/` | Prisma client, soft-delete extension, transaction helpers | Critical (sonnet) |
| `src/server/auth/` | Clerk integration, `getCurrentUser`, `can()`, `AuthContext` | Critical (sonnet) |
| `src/server/services/` | Domain services (no Next.js imports, PRD §6.4) | Money-related services are critical (sonnet) |
| `src/server/{activity,storage,search,jobs}/` | `logActivity`, `StorageProvider`, search index, scheduled job logic | storage, jobs: critical (sonnet) |
| `src/lib/` | `validators/` (Zod contracts), `money.ts`, `rates.ts`, `dates.ts`, `utils.ts` | `money`, `rates` and shared validators: critical (sonnet) |
| `src/features/<module>/` | Module components, thin `actions.ts`, `queries.ts` | `actions.ts` of financial modules: critical (sonnet) |
| `src/app/**` | Routes and layouts (`(auth)`, `(app)`, `s/[token]`, `api/`) | Webhooks, portal and download routes: critical (sonnet) |
| `src/components/ui/` | shadcn components and the shared kit (data-table, MoneyInput, RateInput, combobox, uploader) | |
| `src/i18n/` | `messages/es.json`, `messages/en.json`, `next-intl` config | Shared file: one owner per wave |
| `netlify/functions/` | Scheduled functions (`daily-maintenance`, `cleanup-files`) | Critical (sonnet) |
| `.github/workflows/`, root config (`package.json`, lockfile, `tsconfig.json`, `eslint`, `next.config.*`, `netlify.toml`, `proxy.ts`) | CI and repo config | Shared files: one owner per wave |
| `docs/PRD-WeDevs-Core.md`, `resources/`, `docs/rules/ADE/`, `docs/orca-workflow.md`, `.claude/agents/` | Product source, design reference, process and fleet | The user (agents read, never edit) |
| `docs/rules/*.md` (outside `ADE/`) | Operational rules derived from the PRD | Written by `wedevs-planner` in batch 0 only; afterwards changed only by the user's decision |
| `docs/TASK.md` | Waves, atomic tasks and progress | `wedevs-planner` writes; each agent ticks only its own checkboxes |

Shared files (root `package.json` and lockfile, `prisma/schema.prisma`, `src/i18n/messages/*.json`, the `(app)` layout, sidebar and topbar, `proxy.ts`, a validator consumed by several modules) are written with a **single declared owner per wave**. Later packages consume them; if one needs a change, that change is its own package.

Environments (PRD §6.5): production deploys from `main` on Netlify; previews per PR. **No agent deploys, migrates a remote database, or touches Netlify, Neon, Clerk, the bucket, DNS or secrets** — those are the user's.

## Roles and models

| Agent | Role | Default model | Writes code |
|---|---|---|---|
| `wedevs-project-manager` | Orchestrator (root). Opens the batch, dispatches, integrates, presents the gates. The only agent that speaks Spanish to the user. | sonnet | No |
| `wedevs-planner` | Keeps `docs/TASK.md` (waves, packages, model per package). Coherence review at each wave close. In batch 0 it also writes `docs/rules/*`. | opus | No (only `docs/TASK.md`, and `docs/rules/*` in batch 0) |
| `wedevs-developer` | One package per worktree | haiku (sonnet for critical packages, set by the Planner) | Yes |
| `wedevs-code-reviewer` | Read-only quality gate on the integrated branch | opus | No |
| `wedevs-tester` | Unit and service tests, build, Playwright E2E, i18n and a11y checks, manual pass | haiku | Tests only, when assigned |

Model routing for the Planner is always written per package, never implied:

- **Sonnet (critical code only):**
  - anything in `prisma/` (schema, migrations, complementary SQL, sequences, seed of fiscal settings);
  - auth: Clerk middleware, the Clerk webhook (Svix signature), `getCurrentUser`, `can()` and the permission matrix (PRD §4.3);
  - `proxy.ts` and security headers / CSP (PRD §14);
  - money: `lib/money`, `lib/rates`, and the services and actions of invoices, payments and allocations, accounts and balances, billing plans, installments and recurring charges, expenses and recurring expenses (PRD §8.4–§8.8, §9);
  - the public portal: share links, token resolution, rate limiting, access log (PRD §8.11);
  - file storage: `StorageProvider`, presigned URLs, MIME validation (PRD §14);
  - scheduled jobs (PRD §12) and anything that recomputes cached aggregates;
  - CI workflows;
  - any change to a service signature or shared Zod validator that other modules consume.
- **Haiku (default):** everything else: shadcn components and screens over the existing kit, CRUD of configurable catalogs, i18n messages, read-only reports, the graph UI over an existing data contract, notes and document UI over existing services, tests, and adaptations of a known pattern.
- **Opus:** never for a Developer or the Tester. Reserved for the Planner and the Code Reviewer.
- When a package is borderline, the Planner picks sonnet and says why. It never goes above sonnet for a Developer.

## Required tooling

- Orca CLI (`orca orchestration …`, `orca worktree …`, `orca terminal …`).
- shadcn MCP (`.mcp.json`, enabled in `.claude/settings.json`): **mandatory for every UI package** (user decision DU-02). Developers, the Planner and the Code Reviewer consult it before adding or composing shadcn components; components are installed with the shadcn CLI, never copied by hand.
- Node (LTS pinned in `.nvmrc`) and bun (pinned by `packageManager`). Exact versions are fixed in batch 0 (`docs/rules/stack.md`).
- Podman, for local Postgres (one container per worktree, on its own port):
  ```sh
  podman run -d --name core-pg-<worktree> -e POSTGRES_PASSWORD=dev -p <port>:5432 postgres:17
  ```
  Use `DATABASE_URL=postgresql://postgres:dev@localhost:<port>/core` (and the same value for `DIRECT_URL`). `unaccent` and `pg_trgm` ship with the image's contrib. Stop and remove the container at the end of the task (see safeguards).
- Optional: a local S3-compatible container (e.g. MinIO) to exercise `StorageProvider` without touching the real bucket. Same safeguards as Postgres.
- Clerk: development keys only, placed by the human in `.env.local`. Agents never read, print or commit them. Code under test must allow running without real Clerk credentials (mocked `AuthContext`) for unit and service tests.
- Playwright Chromium, for the Tester: `bun x playwright install chromium`.
- Lighthouse CI (if a batch asks for it) needs Chrome; if the system has none, set `CHROME_PATH` to Playwright's Chromium.

Decided in batch 0 (see `docs/rules/decisions.md`):

- **Database adapter:** plain `@prisma/adapter-pg` in every environment (local, CI, production). The system is database-platform agnostic; Neon is just a Postgres reachable by connection string. No Neon-specific adapter or code path.
- **CI end-to-end tests** run against a Neon **testing** database that the user owns and wires through CI secrets. Agents never touch it: they run E2E only locally against their podman Postgres. `prisma migrate deploy` in the production build is configured by the user.

## Batch types

Delivery is organized in **two milestones** (user decision DU-01, `docs/rules/decisions.md`), which replace the PRD §16 phase order F0–F5; the MVP scope (PRD §3.1) is unchanged and `docs/rules/coverage-matrix.md` maps every capability to both milestones.

- **Milestone 1 (Hito 1) — Complete UI with mock data.** UI batches (`H1-B<n>`) until the whole app is navigable end to end, works on MOCK data (`src/mocks/`, shapes identical to the Zod contracts) and the public portal is usable. It closes with a **fix/change cycle** (`H1-FX<n>` batches opened from user feedback) until the user accepts the UI.
- **Milestone 2 (Hito 2) — Functionality blocks.** Implementation blocks (`H2-B<n>`) that replace the mocks with real logic module by module. **Each block is verified by a deploy**: the user pushes and opens the PR, CI runs, Netlify publishes the deploy preview, the user verifies it and only then is the next block opened. No agent deploys.

1. **Batch 0 — Rules.** No code. The Planner reads the PRD and writes the operational rules for agents (see "Rule index"), plus the two-milestone `docs/TASK.md` skeleton. The user approves the rules before any milestone batch opens.
2. **Milestone batch.** One `H1-B<n>` UI batch or one `H2-B<n>` implementation block, in waves, as outlined in `docs/TASK.md`. A batch may be split if the Planner justifies it. An `H2` block is closed only after the user verifies its deploy preview.
3. **Change / fix batch.** A bounded change or bug fix, usually one package in one wave. If a full `docs/TASK.md` section isn't needed for something that small, the Orchestrator asks the user before skipping the Planner.

Schema changes in any batch are planned as their own package with `prisma/` as the only owner in that wave. Once a migration is on `main`, it is never edited: a fix is a new migration.

## Batch cycle

The process rules in `docs/rules/ADE/phase-gates.md` take priority. `docs/rules/ADE/safeguards.md` also applies.

1. The Orchestrator creates the base branch `batch/<scope>-<topic>` from `main` (e.g. `batch/f0-foundations`, `batch/fix-invoice-status`) and opens the run (`orca orchestration run-create`).
2. The Planner updates `docs/TASK.md`. The Orchestrator validates the model line of each package and presents the plan. **The user approves.**
3. Each wave runs in this order:
   1. Developers work in parallel, one worktree each.
   2. Their work is integrated into the base branch.
   3. The Planner runs its coherence review.
   4. The Code Reviewer checks the integrated branch.
   5. **The user confirms.**
   6. The Tester runs.
   7. The Orchestrator writes the wave close report.
   8. **The user approves** the next wave.
4. **Batch close:**
   1. The user (or the Orchestrator, with explicit approval) pushes the branch and opens the PR.
   2. CI runs; Netlify publishes a deploy preview.
   3. The user merges to `main`. No agent merges to `main`.

## Rule index

Process rules (exist from the setup, owned by the user):

- `docs/rules/ADE/phase-gates.md`: phase control and human approval.
- `docs/rules/ADE/safeguards.md`: runaway processes, local databases, secrets.
- `docs/rules/ADE/use-models.md`: CLI syntax for model and effort per agent.

Operational rules (created by the Planner in batch 0, from the PRD):

- `docs/rules/stack.md`: exact stack and versions (PRD §6.2), discarded approaches.
- `docs/rules/conventions.md`: code conventions and the numbered non-negotiable invariants (at least: services free of Next.js imports and receiving `ctx`, PRD §6.4; every Server Action runs session → `can()` → Zod → service → revalidate, PRD §4.3/§6.4; money is `Decimal`/`decimal.js`, never `float`, USD snapshots never recomputed, PRD §9; money mutations and their aggregates in one `Serializable` transaction or `SELECT … FOR UPDATE`, PRD §14; soft delete by default, PRD §7.7; no hardcoded UI strings, PRD §7.8/§14; sanitized markdown and rich text, PRD §14; portal and file security, PRD §14; no secrets in the repo).
- `docs/rules/data-rules.md`: schema, complementary SQL, sequences, soft delete, search index, migration checklist.
- `docs/rules/frontend-patterns.md`: Overview → Table → Detail, data-table, forms, MoneyInput/RateInput, i18n, theme, Cmd+K, alerts (PRD §7).
- `docs/rules/decisions.md`: decision log (DT-NN from PRD §6.2), open questions (PRD §17 P1–P9, plus the open points above), IOUs.
- `docs/rules/coverage-matrix.md`: fixed MVP scope (which Hito 1 batch and Hito 2 block deliver each capability, PRD §3.1). Read-only after batch 0; it changes only if the user changes the MVP scope.
