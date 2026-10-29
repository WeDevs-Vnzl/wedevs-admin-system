# Test infra and rules sync with sna/platform

Objective: adopt sna/platform's test cadence, evaluation and work-unit rules plus its shared-Postgres integration test
infrastructure (sna TSD DT-19) in wedevs-core. Branch `batch/fix-test-infra` (from `batch/mono-0`). Delivery:
`ask-on-risk`. Runner: Vitest 5 (`apps/api`, projects `unit` / `int` / `e2e`).

## Specs

- **S1** Source request (L1): "sincroniza las reglas de desarrollo, especialmente las de evaluacion y test, con las del
  proyecto de @../../sna/platform/ el cual tiene mejores reglas en este aspecto". Scope chosen by the user: "Rules + full
  tooling" — "port the shared Postgres container with one cloned database per spec (DT-19)".
- **S2** Shared Postgres per run: `int` and `e2e` start one throwaway `postgres:17` container per Vitest project run
  (Testcontainers, `GenericContainer`, no healthcheck exec, `fsync=off`), build one template database with
  `prisma migrate deploy` + `prisma/seed.ts`, and give every spec file its own database cloned from the template
  (serialized by an advisory lock), dropped after the file. Specs keep reading `process.env.DATABASE_URL`. Files run in
  parallel. Works on the podman socket locally and on Docker in CI. Assumption: e2e is included (wedevs e2e specs share
  the database today too; sna's DT-19 covers int only).
- **S3** `test:int:affected` (and `test:e2e:affected`) in `apps/api`: `vitest run --changed "$TEST_BASE"` (default
  `main`), failing with exit 1 on an unknown base ref; `forceRerunTriggers` runs every spec when the diff touches
  dependencies, lockfile, Vitest/TS config, compose, `src/shared/**`, `prisma/**`, shared test helpers or the API
  contract.
- **S4** Invariants: the number of int and e2e tests before and after the port is equal (plus the new self-test), all
  pass; the local-database guard keeps refusing non-local hosts; a self-test spec proves per-file isolation.
- **S5** CI: the api job drops the `postgres:17` service and the manual migrate/seed step; `test:int` and `test:e2e` start
  their own container.
- **S6** Rules (in `wedevs-core/docs/`, not versioned): the sna "what runs when" table, full-run paths, "select by
  dependency graph, never by module already approved", work-unit commits (~400 authored lines, generated output in its
  own `chore(...)` commit, every commit builds/lints/tests, review assessed per commit against the last reviewed commit),
  E2E only against local or staging, never production; DT-117 in `decisions.md`; safeguards/stack/conventions and the
  developer, tester and reviewer agent prompts aligned. Must not contradict phase-gates rule 4a (one review round and
  one test-and-fix round per batch): per-commit checks are the developer's own, not extra review/test rounds.

## Tasks

| ID | Specs | Route | Status | Evidence |
| --- | --- | --- | --- | --- |
| T1 | S2, S4 | inline | done | `9dd566f` (chore: testcontainers), `49e5d3e`; int 29/260, e2e 14/157 green, no leftover container |
| T2 | S3 | inline | done | `3cf788a`; probes: unknown ref exit 1, empty diff runs none, one spec → 1 file, `src/shared` → all |
| T3 | S5 | inline | done | `721ebab`; YAML lint ok; not run on GitHub (no remote) |
| T4 | S6 | inline | done | not versioned (wedevs-core root is not a git repo): conventions, decisions DT-117 (+DT-89 note), stack, safeguards, data-rules, orca-workflow, 4 agent prompts |

Route evidence: no writer trigger (no parallel disjoint units, context below backstop). High risk: item 5 (CI,
dependencies) and item 6 (test infrastructure) → independent verifier at the end.

## Log

- **L1** (2026-10-28) User: "sincroniza las reglas de desarrollo, especialmente las de evaluacion y test, con las del
  proyecto de @../../sna/platform/ el cual tiene mejores reglas en este aspecto"
- **L2** (2026-10-28) User chose scope "Rules + full tooling".
- **L3** Mapping: sna uses Drizzle + `runMigrations()`; wedevs uses Prisma 7, so the template step shells out to
  `prisma migrate deploy` and seeds (specs depend on seeded catalogs). wedevs specs read `DATABASE_URL` at module load,
  so the per-file clone is set from a `setupFiles` module with top-level await. Next free decision: DT-117.
- **L4** Baseline (sequential, manual podman DB, `54701e2`): int 28 files / 257 tests 126 s; e2e 14 / 157 87 s, green.
- **L5** tsconfig is CommonJS (no top-level await): the setup file sets the URL synchronously and clones in the first
  `beforeAll`; specs cannot query at module load either. After: int 29 / 260 (~70–100 s), e2e 14 / 157 (~68–75 s).
- **L6** One unit run had 1 failure that did not reproduce in 4 later runs with and without the change (pre-existing
  flake, unit project untouched). A `pg` "client.query() while executing" deprecation warning comes from existing specs,
  not the new helpers.
- **L7** Rule conflict resolved: sna assesses review per commit; wedevs phase-gates 4a keeps one Code Reviewer round per
  batch. Per-commit assessment applies only to native gentle-ai review; 4a unchanged.
- **L8** Independent verifier: S2-S6 pass, no blockers; advisories: remote DOCKER_HOST briefly creates a container before the guard throws; SIGKILL on rootless podman leaves the container (Ryuk off); forceRerunTriggers drops the vite.config default (no vite config in api).
