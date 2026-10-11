# TASK.md — WeDevs Core

Source of truth for batches, waves, packages and progress. Written by `wedevs-planner`; each agent
ticks **only its own** checkboxes. Process rules: `.rules/ADE/phase-gates.md`,
`.rules/ADE/safeguards.md`, `orca-workflow.md`. Operational rules: `.rules/stack.md`,
`.rules/conventions.md` (invariants `C1`–`C26`), `.rules/data-rules.md`,
`.rules/frontend-patterns.md`, `.rules/decisions.md`, `.rules/coverage-matrix.md`.

---

## Status board

| Batch | Type | Status |
|---|---|---|
| Batch 0 — Rules | rules | Approved |
| H1-B1 — UI foundations | Hito 1 UI batch | **Closed** 2026-10-10 (user approval; local, push/PR at end of Hito 1 per DT-69) |
| H1-B2 — Commercial core UI | Hito 1 UI batch | **In progress** — plan approved 2026-10-10 (DT-78, DT-79); wave 1 closed 2026-10-10; wave 2 approved 2026-10-10 ("aprobado, procede"), running |
| H1-B3 — Finance UI | Hito 1 UI batch | Outline (multi-rate invoices, DT-44) |
| H1-B4 — Documents and portal UI | Hito 1 UI batch | Outline (access keys DT-45, pdf.js DT-50, brand DT-51) |
| H1-B5 — Intelligence UI | Hito 1 UI batch | Outline |
| H1-FX — Fix/change cycle | change batches | Placeholder; ends with the user's explicit "UI accepted" |
| H2-B1 … H2-B7 | Hito 2 implementation blocks | Outline; each closes with the deploy-preview gate. No open blockers (P3/P6/P7 answered, DT-73…DT-75) |

---

## Batch 0 — Rules (delivered)

- **Objective:** write the operational rules from the PRD and the `TASK.md` skeleton. No code, no
  Developers, no Tester.
- **Type:** rules. **Run:** `run_53d4419610e4`. **Base branch:** `batch/0-rules`.
- **Deliverables:**
  - [x] `.rules/stack.md`
  - [x] `.rules/conventions.md`
  - [x] `.rules/data-rules.md`
  - [x] `.rules/frontend-patterns.md`
  - [x] `.rules/decisions.md` (DU-01, DU-02, DT-01…DT-52, P1/P3/P4/P6/P7 open, drift log D1–D12)
  - [x] `.rules/coverage-matrix.md`
  - [x] `TASK.md` skeleton
  - [x] Revision 1: user decisions on DT-31…DT-42, OP-01…OP-06, P2, P5, P8, P9 and the drift items applied
- [ ] **User approval of the rules** (required before H1-B1 opens — `phase-gates.md` rule 3).

🛑 **MANDATORY STOP** — no batch opens until the user explicitly approves batch 0.

---

## Phase rules (apply to every batch below)

Adapted from `.rules/ADE/phase-gates.md` and `.rules/ADE/safeguards.md`; those files win on conflict.

1. **No worker coexistence across phases.** Planner done and released → Developers; all Developers done
   and released → Planner coherence review → Code Reviewer; Code Reviewer done and released → Tester.
   Two phases never have active workers at the same time.
2. **One shared file = one package with a declared single owner per wave.** Each wave below has a
   "Shared-file owners" table. A package touches only the files listed for it. At most **one**
   dependency-changing package (`package.json` + `pnpm-lock.yaml`) per wave and at most one `prisma/`
   owner per wave. Needing a file outside the list → stop and report, never improvise.
3. **Explicit human approval between waves**, repeated at the foot of every wave. Approval is never
   implicit; silence is not approval.
4. **`TASK.md` is the source of truth for progress.** Each agent checks off its own checkboxes; the
   Orchestrator confirms against them, not only against side-channel reports.
5. **Problem reporting at every wave close** — silence is not "no news". Every Developer, the Code
   Reviewer and the Tester report problems explicitly (or state "none").
6. **Model routing is declared per package** with the line
   `Package <id> → Agent: wedevs-developer · <model> — Reason: <one line>`. Never opus for a Developer
   or the Tester. If the declared agent/model is unavailable, the Orchestrator stops and asks.
7. **Code review step in every wave:** after integration and the Planner's coherence review, the
   Orchestrator dispatches `wedevs-code-reviewer` on the integrated base branch, before the Tester.
8. **Tester only with separate explicit user confirmation**, after the Code Reviewer reports
   `READY FOR TESTING`.
9. **Safeguards:** never a persistent server and a browser in the same worker; one container per
   worktree on its own port, removed at the end; explicit timeouts for any persistent process; test
   runners run once; clean up failed attempts before retrying.
10. **No remote operations by agents:** no deploy, no push or PR without explicit user approval, no merge
    to `main`, no Netlify/Neon (including the CI testing database)/Clerk/bucket/DNS/Sentry/secrets.
    Agents never read `.env.local` or CI secrets; agents run E2E only locally (DT-46).
11. **No Claude attribution** in any commit, PR or file (C6). The Orchestrator checks commits before
    integrating (`git log --format=%B <base>..<branch> | grep -i claude`).
12. **UI packages:** every UI package spec carries the line "Use the shadcn MCP" (DU-02, C3).
13. **Open decisions block:** a batch that depends on an OPEN item of `.rules/decisions.md` does not
    open until the user decides it.

---

## Milestones (DU-01)

- **Hito 1 — complete UI over mocks.** H1-B1 → H1-B5, then the H1-FX fix/change cycle. Hito 1 closes
  when the user writes an explicit acceptance of the UI. Every Hito 1 batch closes with the normal
  batch close (user pushes, opens the PR, CI runs, Netlify publishes a deploy preview of the mock UI,
  user merges).
- **Hito 2 — real implementation, block by block.** H2-B1 → H2-B7. Each block closes with the
  **deploy-preview gate** below; the next block opens only after that gate.

### Hito 2 deploy gate (every H2 block)

Agents never deploy or touch Netlify, Neon, Clerk, the bucket, DNS, Sentry or secrets
(`phase-gates.md` rules 9, 11; C26). The flow is:

1. All waves of the block closed (Developers → coherence review → Code Reviewer → Tester), with user
   approval at each wave. Agents' E2E runs are local only (podman Postgres + `next start`).
2. The **user** (or the Orchestrator with the user's explicit approval) pushes the base branch and
   opens the PR to `main`.
3. CI runs: lint, typecheck, unit/service tests (Postgres service container in the job), i18n parity,
   build, and E2E against the **user's Neon testing database** through the `E2E_DATABASE_URL` secret
   the user configured (DT-46). Agents author the workflow but never touch that database or secret.
4. Netlify publishes the deploy preview; the preview uses its own Neon branch and environment variables
   configured by the user; migrations on that branch are applied by the pipeline the user configured,
   never by an agent.
5. The **user** verifies the block's checklist on the preview (each block lists it). Optionally the
   Tester runs Playwright against the preview URL (no local server needed — `safeguards.md` rule 1),
   only if the user asks.
6. `- [ ] Deploy preview verified by the user` is ticked by the Orchestrator **only** after the user's
   explicit statement.
7. The user merges to `main`. The next block's base branch is created from the updated `main`.

---

## H1-B1 — UI foundations

### Header

- **Objective:** a navigable, themed, bilingual application shell over a mock layer, with the full
  shared kit, all Zod contracts, the `can()` matrix and the core money/rate/date libraries, so every
  later Hito 1 batch only builds module screens. At the close: `/sign-in` (mock, no counters) →
  `/dashboard` placeholder inside the full `(app)` layout; sidebar with every module; topbar with
  breadcrumbs, Cmd+K dialog (navigation + quick actions), BCV rate chip, alerts bell shell, ES/EN switch,
  theme toggle, mock user menu ("View as role", "Reset mock data"); `/settings/preferences` working
  (language, theme, time zone); CI green.
- **Type:** phase batch — Hito 1, UI batch 1 of 5 (DU-01).
- **Base branch:** `batch/h1-b1-ui-foundations` (created by the Orchestrator from `main`).
- **PRD sections implemented:** §6.2–§6.4 (stack, folders, backend-separation shape), §7.1 (layout),
  §7.3 (tables kit), §7.4 (form controls), §7.6 (Cmd+K shell), §7.8 (i18n, theme), §4.3 (permission
  matrix as pure code), §9.1–§9.2 (money and rate libraries), §8.15 (preferences), §10.2 enums + approved
  deltas (as contracts), §12 signatures (as contracts), §14 (i18n parity, quality tooling).
- **Decided stack:** `.rules/stack.md` (Next.js 16 with `proxy.ts` naming, `@prisma/adapter-pg` later in
  Hito 2, pdf.js viewer).
- **Binding invariants:** C1, C2, C3, C4, C5, C6, C7, C8, C9, C10 (shape), C11 (shape), C15, C16
  (shape), C17 (shape, contracts only), C22 (shape, contracts only), C23 (shape: uploader), C25.
- **User stories whose UI part this batch covers:** HU-30 (CA1; CA2 within the browser), HU-27 (kit
  behaviour), HU-01 CA3 shape (sign-in route outside the app layout), HU-02 (role-aware UI through
  `can()` and "View as role"). Full closure is in Hito 2 (`coverage-matrix.md` §5).
- **Open decisions:** none blocking. Brand = wireframes (DT-51); sign-in without counters (DT-48).
- **i18n ownership model (DT-31):** namespace files `src/i18n/messages/{es,en}/<namespace>.json`;
  package 2.3 creates **every** namespace file of the fixed list; afterwards each package owns only the
  namespaces (or key blocks) listed for it in its wave.
- **Intra-wave rule:** packages of the same wave never import each other's new files; every package
  builds only on outputs of previous waves.

Fixed namespace list (created by 2.3, never changed in Hito 1 without a dedicated package):
`common, validation, enums, mock, nav, shell, auth, table, forms, patterns, search, alerts, dashboard,
clients, contacts, projects, billing, invoices, payments, accounts, expenses, documents, shares, portal,
notes, tags, activity, graph, reports, settings, catalogs, trash`.

---

### WAVE 1 — Scaffold and dependency set

**Objective:** a building, linting, testing Next.js 16 app with every Hito 1 dependency installed and
every needed shadcn registry component added, so no later Hito 1 package changes the lockfile (DT-38).

**Shared-file owners (wave 1):** package 1.1 owns everything below (single package, single lockfile
owner).

#### Package 1.1 — Scaffold, tooling and shadcn kit installation

Package 1.1 → Agent: wedevs-developer · sonnet — Reason: owns root config, the lockfile and the whole Hito 1 dependency set (shared files every later package consumes; borderline, so sonnet).

Use the shadcn MCP.

Files: `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `.npmrc`, `tsconfig.json`, `next.config.ts`,
`postcss.config.mjs`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `components.json`,
`vitest.config.ts`, `playwright.config.ts`, `tests/setup.ts`, `tests/smoke.test.ts`, `.env.example`,
`netlify.toml`, `src/app/layout.tsx` (minimal), `src/app/globals.css`, `src/app/page.tsx`,
`src/i18n/request.ts` (minimal stub, replaced in wave 2), `src/lib/utils.ts`, `src/components/ui/*`
(registry components only), `src/hooks/*` (only if created by the shadcn CLI), `public/` assets needed by
pdf.js (worker) if the chosen setup requires a static copy.

- [x] Create the Next.js 16 App Router project at the repo root (TypeScript `strict` +
      `noUncheckedIndexedAccess`, `src/` dir, alias `@/*`), without touching process files
      (`PRD-WeDevs-Core.md`, `resources/`, `.rules/`, `orca-workflow.md`, `.claude/`, `README.md`,
      `.mcp.json`, `.gitignore`, `graphify-out/`). No `proxy.ts` in Hito 1 (DT-33).
- [x] Pin exact versions (`.npmrc` `save-exact=true`); Node LTS 24.x in `.nvmrc`; `packageManager` pnpm
      10.x; latest stable Next.js 16.x supported by Netlify's Next.js runtime (verify and report).
- [x] Install every dependency marked "H1-B1" in `.rules/stack.md` (application stack, supporting
      libraries incl. **pdf.js** (`pdfjs-dist`, optionally `react-pdf`), tooling), plus `server-only`.
      Before choosing a supporting library, check with the shadcn MCP whether a registry item covers it.
- [x] Add `shadcn` as an exact-pinned devDependency; run `pnpm exec shadcn init` (CSS variables, Tailwind
      v4) and add, via `pnpm exec shadcn add`, the registry items the kit and shell need — confirm exact
      names with the MCP: button, input, textarea, label, form/field (whichever the registry currently
      recommends), select, checkbox, radio-group, switch, badge, avatar, card, separator, tabs, toggle,
      toggle-group, dropdown-menu, popover, command, dialog, alert-dialog, sheet, drawer, tooltip,
      hover-card, table, pagination, skeleton, sonner, calendar, scroll-area, sidebar, breadcrumb,
      chart, progress, collapsible, accordion, resizable, kbd, input-otp, and any
      input-group/empty/spinner items the registry offers.
- [x] `src/app/globals.css`: light and dark tokens from `frontend-patterns.md` §1 (brand = wireframes:
      monochrome ink primary, canvas, surfaces, strokes, status tones, chart and sidebar tokens); Inter
      via `next/font` with tabular numerals.
- [x] `next.config.ts`: next-intl plugin pointing at `src/i18n/request.ts`; any pdf.js bundling setting
      needed for the worker; no experimental flags without a reason in the report. Minimal
      `src/i18n/request.ts` stub so the build passes; wave 2 replaces it.
- [x] `src/app/layout.tsx`: html/body, font, `NextIntlClientProvider` only (other providers arrive in
      wave 5). `src/app/page.tsx`: redirect to `/dashboard`.
- [x] `eslint.config.mjs`: `eslint-config-next` + Prettier compat + `no-restricted-imports` rules:
      (a) `@/mocks/*` allowed only in the files listed in C9; (b) `@prisma/*` and `@/generated/prisma/*`
      forbidden outside `src/server/` (C7); (c) `next/*`, `react`, `next-intl`, `@clerk/*` forbidden in
      `src/server/services/**` and `src/mocks/services/**` (C11). A JSX literal-string rule (e.g.
      `i18next/no-literal-string` in JSX-text mode or equivalent) as **error** for `src/app/**`,
      `src/components/**`, `src/features/**` (C1), excluding generated `src/components/ui/*` registry
      files if needed (report the exclusion).
- [x] `package.json` scripts: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`),
      `format`, `test` (`vitest run`), `test:coverage`, `test:e2e` (`playwright test`), `i18n:check`
      (`tsx scripts/check-i18n.ts`, script created in wave 2).
- [x] `vitest.config.ts`: jsdom for component tests, node for libs; coverage thresholds ≥ 90 % for
      `src/lib/money.ts`, `src/lib/rates.ts`, `src/lib/finance/**`. `playwright.config.ts`: Chromium
      only, `baseURL` from env, no `webServer` auto-start (`safeguards.md` rule 1).
- [x] `.env.example` with the variable names of `stack.md` § Environments (incl. `SHARE_UNLOCK_SECRET`,
      `APP_URL` placeholder) and placeholder values only, plus a comment that Hito 1 needs none (C5).
      `netlify.toml`: build `pnpm build`, Node version; nothing else.
- [x] Tests: `tests/smoke.test.ts` passes; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all
      pass.
- [x] Report the exact pinned versions (IOU-04) — in particular the exact `shadcn` version for the
      `.mcp.json` pin (DT-49) — the list of registry items added and any registry file edited (C3).

#### Wave 1 close

- [x] **Integration checklist:** package 1.1 merged into `batch/h1-b1-ui-foundations`; no Claude
      attribution in its commits; worktree removed; `pnpm install --frozen-lockfile && pnpm build`
      passes on the base branch.
- [x] **Planner coherence review** (`READY FOR CODE REVIEW` or blockers): dependency set matches
      `stack.md`; ESLint restrictions match C1/C7/C9/C11; no process file touched.
- [x] **Code review** (`wedevs-code-reviewer`, integrated branch): C3, C5, C6, C25; scope respected.
- [x] **User confirms the Tester may run.**
- [x] **Tester scope:** `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
      `pnpm build`. No E2E yet (no screens). No server, no container.
- [x] **`.mcp.json` pin (DT-49):** the Orchestrator presents the pinned `shadcn` version to the user so
      the user pins `.mcp.json` (user-owned file; no agent edits it).
- [x] **Problem report** (Developer, Code Reviewer, Tester — "none" must be stated explicitly).
- [x] **Summary** written by the Orchestrator.

**Wave 1 problem report**

- Developer (1.1): first pass ran Prettier over the whole repo and reformatted process files; restored
  before committing, and process files plus `src/components/ui` added to `.prettierignore`. Rework
  (`1ea2883`) narrowed the C1 exclusion to flat `src/components/ui/*.tsx` (subfolders now linted;
  verified by probe). TanStack Table kept at 9.2.8 (user decision; the registry data-table example uses
  the v9 API).
- Planner: first coherence review wrongly stated the registry example used TanStack v8; corrected by the
  worker, verified by the Orchestrator, re-decided by the user (keep v9).
- Code Reviewer: READY FOR TESTING, no blocking findings. Non-blocking: English sr-only/aria strings in
  registry files need an owner before Hito 1 closes; i18next jsx-text-only mode skips attributes and
  ALL_CAPS identifiers; `chart.tsx` colors must come from tokens only; tabular numerals already global on
  `body`; `/` → `/dashboard` 404 is expected until wave 5. The shadcn MCP was not loaded in the
  Reviewer's session (it checked the registry via the shadcn CLI instead) — to fix before wave 2.
- Tester: PASS. Non-blocking: pnpm ignored build scripts (`@parcel/watcher`, `@swc/core`, `esbuild`,
  `unrs-resolver`); the jsdom Vitest project has no tests yet. Process slips: extra build runs, a scratch
  file in `/tmp` (deleted), an existence-only `ls` of `.env.local` (contents not read).
- Pending drift notes for `.rules/decisions.md` (needs a rules revision by the user): TanStack v9; `field`
  + RHF `Controller` instead of `form`; npm `cn` in registry files vs `@/lib/utils` in hand-written code;
  radix-vega + `@base-ui/react` (spec 3.4 must name the `AsyncCombobox` base); ESLint 9.39.5; C1 gap;
  per-file Vitest thresholds from H1-B3; Next 16.4.0 on Netlify unconfirmed until the first preview;
  spec 3.6 must verify the pdf.js worker under Turbopack.

**Wave 1 summary**

Scaffold delivered on `batch/h1-b1-ui-foundations` (`42bbf06`, `1ea2883`): Next.js 16.4.0, React 19.3,
Tailwind 4.3, shadcn 4.21.4 (radix-vega) with 45 registry items, next-intl stub, Vitest/Playwright
config, ESLint invariants C1/C7/C9/C11. Install, lint, typecheck, test and build pass. `.mcp.json` pin to
`shadcn@4.21.4` presented to the user (user-owned file).

🛑 **MANDATORY STOP** — wave 2 does not start without the user's explicit approval.

---

### WAVE 2 — Contract primitives, core libraries, i18n and theme

**Objective:** the shared primitives every later package imports: common/enum/money/file contracts,
the permission matrix and the session seam; `lib/money`, `lib/rates`, `lib/dates`; i18n loading with
all namespace files, theme provider and switchers.

**Shared-file owners (wave 2):**

| Shared file / area | Owner |
|---|---|
| `src/lib/validators/{common,enums,money,files}.ts` | 2.1 |
| `src/server/auth/*` | 2.1 |
| `src/mocks/session.ts` | 2.1 |
| `src/lib/{money,rates,dates}.ts` | 2.2 |
| `src/i18n/**` (all namespace files, request, config) | 2.3 |
| `package.json` / lockfile | nobody (no dependency changes) |

#### Package 2.1 — Contract primitives, permission matrix and session seam

Package 2.1 → Agent: wedevs-developer · sonnet — Reason: shared validators consumed by every module plus `can()` and the permission matrix (auth-critical).

Files: `src/lib/validators/common.ts`, `src/lib/validators/enums.ts`, `src/lib/validators/money.ts`,
`src/lib/validators/files.ts`, `src/server/auth/types.ts`, `src/server/auth/permissions.ts`,
`src/server/auth/session.ts`, `src/mocks/session.ts`, tests next to each file.

- [x] `common.ts`: `ActionResult<T>` and `actionError` helpers; error codes `UNAUTHENTICATED`,
      `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `INTEGRITY_LOCK`, `ACCESS_KEY_INVALID`,
      `ACCESS_KEY_LOCKED`, `INTERNAL`; `warnings[]`; `idSchema`; `EntityRef { id, code?, label, type }`;
      `dateOnlySchema` (`YYYY-MM-DD`); `listQuerySchema` (page ≥ 1, pageSize 25|50|100, sort
      `field:asc|desc`, `q`, typed filter map, `includeArchived`); `Paginated<T>`.
- [x] `enums.ts`: every enum of PRD §10.2 value by value, **with the approved delta** `ShareEvent` +
      `UNLOCK`, `UNLOCK_FAILED` (`data-rules.md` §3a Δ2), as `const` tuples + `z.enum` + TS types (C8).
- [x] `money.ts`: `moneyAmountSchema` (decimal string, max 2 decimals, `Decimal(18,2)` range, sign
      rules via options), `rateSchema` (> 0, max 8 decimals), `percentSchema` (0–100, 2 decimals, also
      used for VAT rates), `currencyCodeSchema`, `MoneyDTO`. No `z.number()` for money (C15).
- [x] `files.ts`: `requestUploadInputSchema` (name, mime, size, context), allowlists and limits per
      context — 25 MB general, 10 MB payment receipts (DT-41, C23) — `UploadAdapter` interface, `FileDTO`.
- [x] `server/auth/types.ts`: `SessionUser { id, name, email, imageUrl, role, locale, theme }`,
      `AuthContext`.
- [x] `server/auth/permissions.ts`: `can(user, action, resource, opts?)` implementing the full PRD §4.3
      matrix (Member `D` on notes only when `opts.ownerId === user.id`; share, reports, activity,
      settings, users, trash rows), plus `canSeeFinancials(user)` (§11). Pure, framework-free (DT-40).
- [x] `server/auth/session.ts`: `getSessionUser(): Promise<SessionUser | null>` and
      `requireSessionUser()`; in Hito 1 delegates to `@/mocks/session` (allowed by C9).
- [x] `mocks/session.ts` (`// MOCK`): two fictional Owner users (as in the wireframes) and the MOCK-only
      role override read from the `wd_mock_role` cookie.
- [x] Tests: table-driven test of the whole §4.3 matrix; schema tests for `listQuerySchema`,
      `moneyAmountSchema` (rejects numbers, > 2 decimals), `rateSchema`, file limits per context.

#### Package 2.2 — Money, rate and date libraries

Package 2.2 → Agent: wedevs-developer · sonnet — Reason: `lib/money` and `lib/rates` are money-critical (C15, ≥ 90 % coverage).

Files: `src/lib/money.ts`, `src/lib/rates.ts`, `src/lib/dates.ts`, `src/lib/money.test.ts`,
`src/lib/rates.test.ts`, `src/lib/dates.test.ts`.

- [x] `money.ts`: a configured `Decimal` (`decimal.js`, `ROUND_HALF_UP`); `toDecimal(string)`,
      `roundMoney` (2 dp), `sumMoney`, `percentOf(base, rate)` (for VAT), `toUsd(amount, usdRate)` =
      `round(amount / usdRate, 2)`, `fromUsd`, `isSettled(balance)` (≤ 0.01), `compareMoney`,
      `formatMoney(amount: string, currency, locale)` via `Intl.NumberFormat` (display only). No
      `parseFloat`/`Number`/`toFixed` for math (C15).
- [x] `rates.ts`: `selectRate(rates, date, currency)` implementing §9.2 prefill order (exact date →
      latest previous with `isFallback` + `effectiveDate` → `null` for manual), USD always `"1"`;
      `rateDeviationExceeds(newRate, lastRate, 10)` (§15).
- [x] `dates.ts`: `todayInCaracas(now)`, `toDateOnly`, `parseDateOnly`, `addDays`, `daysBetween`,
      `isBusinessDay`, `formatDate(date, locale, style, timeZone = 'America/Caracas')`,
      `formatDateTime` — `date-fns-tz`; business "today" always Caracas, display zone a parameter
      (DT-43).
- [x] Tests with ≥ 90 % coverage on `money.ts` and `rates.ts`, including HU-13 CA2 arithmetic
      (100 − 3 = 97), VES 755.16 conversions, half-up rounding edge cases, rate fallback, date
      boundaries around midnight UTC vs Caracas.

#### Package 2.3 — i18n loading, all namespaces, theme provider and switchers

Package 2.3 → Agent: wedevs-developer · haiku — Reason: i18n messages and small client components over an existing pattern.

Use the shadcn MCP.

Files: `src/i18n/config.ts`, `src/i18n/namespaces.ts`, `src/i18n/request.ts`,
`src/i18n/messages/es/*.json`, `src/i18n/messages/en/*.json` (every namespace of the fixed list),
`src/components/app/theme-provider.tsx`, `src/components/app/locale-switcher.tsx`,
`src/components/app/theme-toggle.tsx`, `scripts/check-i18n.ts`, `scripts/check-i18n.test.ts`.

- [x] `config.ts`: locales `['es','en']`, default `es`, cookie `NEXT_LOCALE`, default time zone
      `America/Caracas`.
- [x] `namespaces.ts`: the fixed namespace list; `request.ts` reads the cookie, loads and merges every
      namespace for the locale, sets `timeZone` and default formats (DT-31).
- [x] Create every namespace file in both languages. Fill now: `common`, `validation`, `enums` (every
      enum value incl. the Δ2 `ShareEvent` additions, as `enums.<EnumName>.<VALUE>`, ES and EN), and the
      switcher keys under `shell`. All other namespaces start as `{}`.
- [x] `theme-provider.tsx` (next-themes, `class`, light/dark/system); `theme-toggle.tsx` and
      `locale-switcher.tsx` from registry items. The locale switch writes the `NEXT_LOCALE` cookie on the
      client and calls `router.refresh()`.
- [x] `scripts/check-i18n.ts`: fails on missing/extra keys between locales, missing namespace files and
      empty-string values (C2).
- [x] Tests: the parity script on fixtures. The `enums` keys are written from the PRD §10.2 list + Δ2
      (2.1 is built in parallel); the Planner checks `enums` ↔ `enums.ts` at the wave close.

#### Package 2.4 — Contract i18n keys and parity-test wiring (wave 2 follow-up, Planner coherence blockers B1, B2)

Package 2.4 → Agent: wedevs-developer · haiku — Reason: i18n messages plus a one-line test-include change and a key-existence test over existing contracts.

Files: `src/i18n/messages/{es,en}/validation.json`, `src/i18n/messages/{es,en}/common.json`,
`src/i18n/contract-keys.test.ts` (new), `vitest.config.ts`. Read-only: `src/lib/validators/{common,enums}.ts`.

- [x] `validation.json` (ES and EN): add every key in `VALIDATION_MESSAGES` as nested objects
      (`id.invalid`, `date.invalid`, `sort.invalid`, `money.*`, `rate.*`, `percent.*`, `currency.invalid`,
      `file.*`); keep `required`; remove the unused flat duplicates `invalidDate` and `invalidId`.
- [x] `common.json` (ES and EN): add `errors.<CODE>` for all 9 values of `ERROR_CODE_VALUES`.
- [x] `src/i18n/contract-keys.test.ts`: per locale, every `VALIDATION_MESSAGES` value and every
      `common.errors.<CODE>` resolves to a non-empty string; `enums` catalog keys equal `ENUM_REGISTRY`.
- [x] `vitest.config.ts`: add `scripts/**/*.test.ts` to the node project `include`; if `.vitest/` comes
      from a configurable Vitest option, send it to an ignored location, otherwise report it (no
      `.gitignore` edit).
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` pass; the `check-i18n` and
      `contract-keys` suites appear in the run.

#### Package 2.5 — formatMoney for non-ISO currency codes (wave 2 follow-up, blocker B3)

Package 2.5 → Agent: wedevs-developer · sonnet — Reason: change to `lib/money` (money-critical, C15, ≥ 90 % coverage).

Files: `src/lib/money.ts`, `src/lib/money.test.ts`.

- [x] `formatMoney`: when `currency` is not a well-formed 3-letter ISO 4217 code (e.g. `USDT`), format
      the rounded string as a 2-decimal locale number with the code appended (no exception); ISO codes
      unchanged. No number conversion for math (C15).
- [x] Tests: `formatMoney("1234.5", "USDT", "en-US")` and `"es-VE"`; ISO cases unchanged; `money.ts`
      coverage stays ≥ 90 %.

#### Package 2.6 — UTC-safe date arithmetic, i18n format cleanup, placeholder parity (wave 2 follow-up, Code Review B1, M1, m1, m5)

Package 2.6 → Agent: wedevs-developer · sonnet — Reason: date arithmetic feeding due dates/overdue status (§9.4) and a `lib/money` cast; money-adjacent and shared `lib/`.

Files: `src/lib/dates.ts`, `src/lib/dates.test.ts`, `src/lib/money.ts`, `src/i18n/request.ts`,
`scripts/check-i18n.ts`, `scripts/check-i18n.test.ts`, `vitest.config.ts`.

- [x] `addDays` (and `daysBetween`) on date-only values do pure UTC arithmetic (`setUTCDate`, exact
      `/ 86_400_000`), independent of the process time zone.
- [x] Tests prove it under non-UTC zones across DST changes (`Europe/Madrid`, `America/New_York`, e.g.
      `addDays("2026-03-07", 2)` → `"2026-03-09"`, `addDays("2026-03-10", 30)` → `"2026-04-09"`); run the
      node test project with a non-UTC `TZ` (e.g. `env.TZ` in `vitest.config.ts`) or set it per test.
- [x] `src/i18n/request.ts`: remove the fixed-USD `number.currency` format and point the comment at
      `formatMoney` from `@/lib/money` (C15).
- [x] `src/lib/money.ts`: replace the `as unknown as …` double cast in `formatMoney` with a single
      `` `${number}` `` cast (or no cast); coverage stays 100 %.
- [x] `scripts/check-i18n.ts`: fail when a key's `{placeholder}` name set differs between ES and EN;
      tests for pass and fail cases.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build` pass.

#### Package 2.7 — Global Zod error map to i18n keys, upload extension fallback (wave 2 follow-up, Code Review B2, M2, m2, m6, m7)

Package 2.7 → Agent: wedevs-developer · sonnet — Reason: change to shared validators (contract for every form and Server Action) and upload checks (file security, C23).

Files: `src/lib/validators/common.ts`, `src/lib/validators/files.ts`, `src/lib/validators/zod-config.ts`
(new), their tests (`src/lib/validators/*.test.ts`), `src/i18n/messages/{es,en}/validation.json`,
`src/i18n/contract-keys.test.ts`, `src/mocks/session.ts`.

- [x] One global `z.config({ customError })` in `zod-config.ts`, imported for its side effect by
      `common.ts`; maps Zod issue codes to `validation.*` keys (`invalid_type` → `required` when input is
      `undefined`, else `invalidFormat`; `invalid_value` → `invalidOption`; `too_small`/`too_big` →
      `tooShort`/`tooLong` or numeric `tooSmall`/`tooLarge`; `invalid_format` → `invalidFormat`; fallback
      `invalidFormat`). Custom messages keep precedence.
- [x] Every generic key is registered in `VALIDATION_MESSAGES`; flat keys in `validation.json` are either
      registered or removed (no orphans), ES and EN in parity; `contract-keys.test.ts` covers them.
- [x] Test: bad inputs to every exported primitive schema (`idSchema`, `dateOnlySchema`,
      `listQuerySchema`, money/rate/percent/currency, files schemas, a `z.enum` from `enums.ts`) yield
      only messages starting with `validation.`.
- [x] `checkUpload`: strip MIME parameters; when MIME is empty or `application/octet-stream`, fall back
      to the extension against `allowedExtensions`; tests for `notes.md` with `""` and with
      `application/octet-stream`, and a disallowed extension still rejected.
- [x] `validation.file.tooLarge` interpolates `{max}` (ES and EN) and `checkUpload` provides it.
- [x] `common.ts`: one shared sort-token regex constant.
- [x] `src/mocks/session.ts`: default user declared as its own typed constant (no `as SessionUser`).
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build` pass.

#### Package 2.8 — Guaranteed Zod error-map install, schema-path size message (wave 2 follow-up, Code Review re-check B1, M1, m1, m2)

Package 2.8 → Agent: wedevs-developer · sonnet — Reason: change to shared validators (contract for every form and Server Action) and a root lint rule guarding it.

Files: `src/lib/validators/zod.ts` (new), `src/lib/validators/{common,enums,money,files,zod-config}.ts`,
their tests (`src/lib/validators/*.test.ts`, incl. a new enums-only isolation test),
`src/i18n/messages/{es,en}/validation.json`, `src/i18n/contract-keys.test.ts`, `eslint.config.mjs`.

- [x] `src/lib/validators/zod.ts`: `import "./zod-config"; export { z } from "zod";` — every validator
      module imports `z` from it (never `"zod"` directly); `zod-config.ts` and `zod.ts` are the only
      `"zod"` importers in `src/` besides tests that need the raw module.
- [x] `eslint.config.mjs`: `no-restricted-imports` forbids `"zod"` in `src/**` except
      `src/lib/validators/{zod,zod-config}.ts` (message points to `@/lib/validators/zod`).
- [x] Isolation test: a test file importing only `./enums` asserts enum parse errors start with
      `validation.` (no `common.ts` import in that file).
- [x] Size message on the schema path: `file.tooLarge` without placeholder (schema/`fieldErrors` path),
      new `file.tooLargeMax` with `{max}` returned by `checkUpload`; ES and EN; registered in
      `VALIDATION_MESSAGES`; test that the schema path yields `validation.file.tooLarge` and resolves
      without values.
- [x] `zod-config.ts`: `too_small` on strings with `minimum === 1` and `input === null` map to
      `validation.required`; tests. Note: implemented on string `too_small` with `minimum === 1` (empty text); `input === null` never reaches `too_small` (null is `invalid_type`, kept as `invalidFormat`).
- [x] `checkUpload` passes the size as a number (`{max: 25}`), the unit "MB" lives in the message text.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build` pass.

#### Wave 2 close

- [x] **Integration checklist:** 2.1, 2.2, 2.3 merged; no Claude attribution; worktrees removed;
      `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build` pass.
      Follow-ups 2.4 (merge 5b93fbe) and 2.5 (merge 9e59339) merged the same way; integrated checks
      re-run green (13 files, 554 tests; i18n parity 32 namespaces; build OK).
- [x] **Planner coherence review:** `enums` namespace keys ↔ `enums.ts` values; `money.ts` schemas ↔
      `lib/money` string conventions; `can()` resources cover every row of §4.3; no overlap.
      First pass NOT READY (B1 missing validation/common.errors keys, B2 scripts tests not in vitest,
      B3 formatMoney throws on USDT) → packages 2.4/2.5; re-check: B1–B3 CLOSED, READY FOR CODE REVIEW.
- [x] **Code review:** C1, C2, C5, C6, C8, C9, C11 shape, C15, C25.
      First pass CHANGES REQUIRED (B1 `addDays` DST bug, B2 C1 Zod default messages in English;
      M1 fixed-USD i18n format, M2 upload MIME fallback) → packages 2.6/2.7. Deferred: m3 (`can()`
      grants update/delete on `activity`, contradicts C20) → pending `can()` vocabulary decision;
      m4 (date-only check duplicated in `common.ts` and `dates.ts`) → H1-FX.
      Re-check after 2.6/2.7: CHANGES REQUIRED (B1 error map not installed for enums-only imports;
      M1 `{max}` lost on the schema path) → package 2.8. 2.7 deviations accepted (checkUpload
      `{key, values?}`, generic tooShort/tooLong without params, `mime` without `min(1)`).
      Third pass after 2.8: READY FOR TESTING, all invariants PASS. Carried to wave 3 (forms kit):
      n1 ESLint `no-restricted-imports` must also block `zod/*` subpaths; n2 `invalid_type` with
      `input === null` → `validation.required` (cleared select/combobox) with a test.
- [x] **User confirms the Tester may run.** Confirmed 2026-10-09 ("mcp reconectado, procede").
- [x] **Tester scope:** `vitest run --coverage` (report coverage of `money.ts` and `rates.ts`, ≥ 90 %),
      permission matrix test, `pnpm i18n:check`, `pnpm build`. No E2E.
      Tester (wedevs-tester · haiku) on acd2167: ALL PASS, no commits. 15 files / 646 tests, 0 failed.
      `money.ts` 100 % stmts (37/37), branches (16/16), funcs (18/18), lines (35/35);
      `rates.ts` 100 % stmts (26/26), branches (24/24), funcs (3/3), lines (21/21).
      `permissions.test.ts` 262 tests pass (PRD §4.3 matrix). i18n:check es/en × 32 namespaces in
      parity; build (Next 16.4, Turbopack) OK; lint and typecheck OK.
- [x] **Problem report** (explicit, per agent).
      - Developers 2.1–2.3: Planner blockers B1–B3 (missing validation/common.errors keys, scripts tests
        outside vitest, formatMoney throwing on USDT) → fixed by 2.4/2.5.
      - Code Reviewer pass 1: `addDays` DST bug, Zod default English messages, fixed-USD i18n format,
        upload MIME fallback → fixed by 2.6/2.7. Pass 2: error map not guaranteed for enums-only
        imports, `{max}` lost on schema path → fixed by 2.8.
      - Orca restart lost two in-flight dispatches (terminal_missing); resumed on the same worktrees.
      - shadcn MCP timed out for part of the wave (reviewer used `pnpm exec shadcn view`); reconnected.
      - Tester: none.
      - Open, carried: n1, n2 → wave 3 forms kit; m3 → pending `can()` vocabulary decision (C20);
        m4 → H1-FX.
- [x] **Summary.** Wave 2 delivered the shared foundations: enums + i18n `enums` namespace, Decimal
      money/rates helpers with full coverage, UTC date helpers, `can()` matrix per PRD §4.3, common
      validators with a guaranteed global Zod error map to `validation.*` keys (raw `zod` import
      blocked by ESLint), upload checks, ICU placeholder parity in `i18n:check`. 8 packages
      (2.1–2.8), 3 review passes, all invariants PASS; closed 2026-10-09.

🛑 **MANDATORY STOP** — wave 3 does not start without the user's explicit approval.

---

### WAVE 3 — Module contracts and the shared UI kit

**Objective:** every module's Zod contract (DT-39, including P2 multi-rate invoices and P5 access keys)
and the shared UI kit, all built only on wave 1–2 outputs.

**Shared-file owners (wave 3):**

| Shared file / area | Owner |
|---|---|
| `src/lib/validators/{users,preferences,clients,contacts,projects,technologies,tags,notes,document-types,documents,shares,activity,search,graph,alerts,trash}.ts` | 3.1 |
| `src/lib/validators/{catalogs,settings,billing,invoices,payments,accounts,expenses,dashboard,reports}.ts` | 3.2 |
| `src/components/ui/data-table/**`, i18n namespace `table` | 3.3 |
| `src/components/ui/{money-input,rate-input,async-combobox,date-field,phone-input,country-combobox,uploader}/**`, i18n namespace `forms` | 3.4 |
| `src/components/patterns/**` (incl. `use-unsaved-changes.ts`), i18n namespace `patterns` | 3.5 |
| `src/components/ui/pdf-viewer/**`, i18n namespace `common` (only to add the `pdfViewer` key block; sole `common` owner this wave) | 3.6 |
| `src/lib/rates.ts`, `src/lib/rates.test.ts`, `src/server/auth/permissions.ts`, `src/server/auth/permissions.test.ts`, `src/lib/validators/zod-config.ts` (+ its test), `eslint.config.mjs` | 3.7 |
| `src/lib/validators/{common,enums,money,files}.ts` | nobody (read-only this wave) |
| `package.json` / lockfile | nobody |

3.1 and 3.2 do **not** import each other's files; cross-module references use `EntityRef` and ids from
`common.ts`.

#### Package 3.1 — Contracts: commercial, knowledge and cross-cutting

Package 3.1 → Agent: wedevs-developer · sonnet — Reason: shared Zod contracts and service DTOs consumed by many modules and by Hito 2 services (PRD §6.4 rule 3), incl. the portal access-key contract (security).

Files: `src/lib/validators/{users,preferences,clients,contacts,projects,technologies,tags,notes,document-types,documents,shares,activity,search,graph,alerts,trash}.ts` and their `*.test.ts`.

- [x] For each module: create/update input schemas, list-row DTO (the table columns of PRD §8.x),
      detail DTO, filter schema extending `listQuerySchema`, and the input/output types of every PRD §12
      service of the module (exact names, `fn(ctx, input)` shape documented in a type alias).
- [x] Clients (§8.2): `legalName` required for `EMPRESA`; tax-id format validated when country is `VE`
      (RIF V/E/J/G/P); ISO 3166-1 alpha-2; E.164 phone; status default `PROSPECTO`; financial metrics as
      money strings. Contacts: name + at least one of email/phone; `isPrimary`.
- [x] Projects (§8.3): ≥ 1 client with optional role; `summary` ≤ 280; transition input with
      `startDate` required for `EN_CURSO`, `endDate` for `ENTREGADO`; links (group enum, label, valid
      URL, order); stack as technology ids only. Technologies and document types/categories with
      `name`/`nameEn`.
- [x] Notes (§8.10) and tags (§7.5) as specified in the PRD.
- [x] Documents (§8.9): fields, formats, statuses and transitions (`signedAt` required for `FIRMADO`
      only on types with signature; `expiresAt` only on types with expiration), versions, draft save,
      publish, restore, links.
- [x] Shares (§8.11 + DT-45): title, message, client, documents with pinned `versionId` or latest,
      **per-document `requiresAccessKey`**, `allowDownload`, locale, expiry; inputs
      `setShareDocumentAccessKey` (generate | regenerate | remove; the clear key is returned **once** in
      the result DTO and never in any read DTO) and `unlockSharedDocument` (token, documentId, key,
      min length 8); share DTOs with counters (views, downloads, failed unlocks) and access-log rows; a
      portal DTO exposing only what the visitor may see, with `locked: boolean` per document (C22).
- [x] Activity (§8.14), search (§7.6), graph (exactly §8.12.5), alerts (the nine types, `alertKey`,
      dismiss/snooze), trash, users and preferences (role change, invitation input, keys
      `table:<id>:columns`, `locale`, `theme`, `timezone` — DT-43).
- [x] Tests: each schema accepts a valid example and rejects each rule violation listed above; no read
      DTO of shares contains a key or hash.

#### Package 3.2 — Contracts: finance, catalogs, dashboard and reports

Package 3.2 → Agent: wedevs-developer · sonnet — Reason: money contracts (multi-rate invoices, payments, allocations, accounts, billing, expenses) consumed by every financial screen and service.

Files: `src/lib/validators/{catalogs,settings,billing,invoices,payments,accounts,expenses,dashboard,reports}.ts` and their `*.test.ts`.

- [x] Catalogs (§8.15): currencies, exchange rates with **`source`** (`rateSourceSchema`; one rate per
      date + currency + source, DT-67) (incl. quick daily load and CSV import row), payment
      methods, expense categories (two-level tree). Settings: company; fiscal with **`ivaRates`** (allowed
      VAT rates, default `["16","8","0"]`), `ivaDefaultRate` (`"16"`), IGTF 3, methods/currencies
      proposing IGTF, invoice due days 15 (DT-44).
- [x] Billing (§8.4): plan, installments, templates (100, 50/50, 40/30/30, 30/40/30, 3 equal, custom),
      recurring charges (billing day 1–28, lead days default 7), "generate missing periods" input,
      project financial summary DTO (§8.4.4).
- [x] Invoices (§8.5 + DT-44): header fields (no header VAT rate); **lines** (description, project,
      installment, quantity, unit price, line discount ≤ amount, `ivaRate` from the allowed list or
      `null` = exempt); computed line `amount`/`netAmount`; **tax lines** DTO (rate, base, IVA) with an
      input allowing a ±0.01 adjustment per rate; header totals DTO (subtotal, discount, exempt amount,
      tax base, IVA total, total, withholdings IVA/ISLR/other + note, receivable, USD snapshots); file id;
      draft flag; void input (reason required); list/detail DTOs with balance, USD values, days overdue,
      "partial payment" flag; "invoice installments" wizard input.
- [x] Payments (§8.6, §9.5, §9.6): fields incl. IGTF, fee, reference (required when the method requires
      it), receipt, status; allocations; duplicate-warning DTO.
- [x] Accounts (§8.7, §9.7) and expenses (§8.8) as specified in the PRD (masked identifiers,
      `accountAmount`, mark-paid, recurring day 1–28, lead days default 5).
- [x] Dashboard (§8.1) and reports (§8.13): KPI card DTO, chart series DTOs, report filter schema, report
      and KPI ids; "taxes registered" report DTO with IVA **per rate**.
- [x] Tests: money fields reject numbers and > 2 decimals; rates > 0; line discount > amount rejected;
      VAT rate outside the allowed list rejected; tax-line adjustment beyond ±0.01 rejected; transfer from
      = to rejected; void without reason rejected; billing day outside 1–28 rejected.

#### Package 3.3 — Kit: data-table

Package 3.3 → Agent: wedevs-developer · haiku — Reason: composition of the registry data-table example over the existing `listQuerySchema` contract.

Use the shadcn MCP.

Files: `src/components/ui/data-table/**` (table, toolbar, faceted filter, filter chips, debounced
search, view options/column config, pagination, selection + bulk bar, export button, empty state,
skeleton, `use-table-url-state.ts`), `src/i18n/messages/{es,en}/table.json`, tests under
`src/components/ui/data-table/`.

- [x] Follow the registry data-table example (MCP) with TanStack Table, **manual** (server)
      pagination/sorting/filtering; page sizes 25/50/100; state in the URL through `nuqs` parsers that
      round-trip `listQuerySchema` (`frontend-patterns.md` §5).
- [x] Faceted filters as "+ Field" buttons that become removable chips and "Limpiar"; date-range and
      async-option facets supported via props.
- [x] Column visibility, order and width; `onColumnsChange` / `initialColumns` props. Multi-select with a
      bulk-action bar. Export button calls `onExport(query, visibleColumns)`. "Show archived" toggle only
      when a prop allows it.
- [x] Empty state with CTA slot and skeleton rows; sticky header; horizontal scroll with code/name
      pinned on narrow screens.
- [x] Strings from `table` (C1). Tests: URL state round trip; page-size guard; column state callback.

#### Package 3.4 — Kit: money, rate, combobox, date, phone, country, uploader

Package 3.4 → Agent: wedevs-developer · sonnet — Reason: `MoneyInput`/`RateInput` carry money semantics for every financial form (C15) and the uploader fixes the file-contract boundary (C23).

Use the shadcn MCP.

Files: `src/components/ui/money-input/**`, `src/components/ui/rate-input/**`,
`src/components/ui/async-combobox/**`, `src/components/ui/date-field/**`,
`src/components/ui/phone-input/**`, `src/components/ui/country-combobox/**`,
`src/components/ui/uploader/**`, `src/i18n/messages/{es,en}/forms.json`, tests next to each component.

- [x] `MoneyInput`: currency select + amount text input holding a decimal string; locale-aware typing
      normalized to the canonical string; live USD equivalent through `lib/money` given a `usdRate` prop;
      works with react-hook-form `Controller`. Never stores a `number` (C15).
- [x] `RateInput`: `lookupRate(date, currency)` prop; prefill, "Usando tasa del dd/mm" on fallback,
      manual when `null`, USD locked at 1, > 10 % deviation warning.
      **DT-67:** `lookupRate` resolves to `RateLookupResult | null`, a type declared in `rate-input`
      (do not import it from `lib/rates`; 3.7 changes that file in parallel and the shapes must match
      structurally): `{ usdRate: string; isFallback: boolean; effectiveDate: string; source: RateSource
      | null; options: { source: RateSource; usdRate: string; createdAt: string }[] }`, with `RateSource`
      from `@/lib/validators/enums`. When `options.length > 1`, show a source selector (labels from
      `enums.RateSource`) that preselects `source`; picking a source sets that rate. Typing a value by hand
      still works. Test: two options → selector shown with BCV preselected; switching source updates the
      value.
- [x] `AsyncCombobox` (single and multi): debounced `loadOptions(q)`, keyboard navigation, optional
      "Crear nuevo" (`onCreate(q)`), grouped options, optional per-item secondary input.
- [x] `DateField` (`YYYY-MM-DD`, display time zone prop, default Caracas), `PhoneInput` (E.164),
      `CountryCombobox` (ISO alpha-2 with flags, localized names via `Intl`).
- [x] `Uploader`: drop zone + file list driven by an `UploadAdapter` prop; enforces the context's
      allowlist and size limit (25 MB general, 10 MB payment receipts); no network code of its own.
- [x] Strings from `forms` (C1). Tests: `MoneyInput` ("1.234,56" in ES → "1234.56"; USD at "755.16");
      `RateInput` fallback and USD lock; uploader rejects a disallowed MIME and an oversize file per
      context.

- Base for `AsyncCombobox` (DT-56): **Base UI** via the registry `combobox` (`@base-ui/react`, `filter={null}` for server-side search). `CountryCombobox` / `PhoneInput` prefix: registry `popover` + `command`. No registry item exists for phone input or a dropzone, so `PhoneInput` (libphonenumber-js) and `Uploader` are compositions of installed registry components.

#### Package 3.5 — Page, overview, detail and form patterns

Package 3.5 → Agent: wedevs-developer · haiku — Reason: presentational compositions of registry components following the wireframes.

Use the shadcn MCP.

Files: `src/components/patterns/**` (`page-header`, `overview-table-toggle`, `overview-layout`,
`kpi-card`, `stat-card`, `detail-header`, `detail-tabs`, `side-panel-card`, `financial-summary-card`,
`related-mini-table`, `status-badge`, `entity-code-chip`, `empty-state`, `confirm-dialog`,
`archived-banner`, `form-page`, `use-unsaved-changes.ts`, `section-card`, `money-text`, `date-text`),
`src/i18n/messages/{es,en}/patterns.json`, tests next to the components.

- [x] Build each pattern per `frontend-patterns.md` §1, §1a (lucide mapping), §3, §4, §6, §9 and
      wireframes 4.2, 4.4, 4.5: `DetailHeader` with the always-visible **Detalle | Grafo** toggle,
      `DetailTabs` with counts and `?tab=` via `nuqs`, `OverviewTableToggle`, dark `FinancialSummaryCard`.
- [x] `StatusBadge`: every enum value of `enums.ts` → tone + `enums.*` label; secondary indicator
      ("Pago parcial").
- [x] `ConfirmDialog`: archive/void/cancel variants, optional required reason, optional extra checkbox.
- [x] `MoneyText`/`DateText` through `formatMoney`/`formatDate` with the current locale and display zone.
- [x] `FormPage` (title, sections, sticky footer actions) + `use-unsaved-changes.ts`.
- [x] Strings from `patterns` (+ `enums`, read-only). Tests: `StatusBadge` covers every enum value;
      `DetailTabs` reads/writes `?tab=`; the unsaved-changes guard fires on a dirty form.

#### Package 3.6 — Kit: PDF viewer (pdf.js)

Package 3.6 → Agent: wedevs-developer · haiku — Reason: UI component over an installed library following the portal wireframe; no data or security logic.

Use the shadcn MCP.

Files: `src/components/ui/pdf-viewer/**`, the `pdfViewer` key block in
`src/i18n/messages/{es,en}/common.json`, tests in `src/components/ui/pdf-viewer/`.

- [x] `PdfViewer` client component, lazy-loaded, rendering a PDF from a URL with pdf.js (DT-50); toolbar
      per wireframe 4.8: page x / y with previous/next, zoom − / 100 % / +, download (calls an
      `onDownload` prop — the viewer never builds download URLs itself), fullscreen; loading skeleton and
      error state; keyboard-operable toolbar; worker served from the app origin.
- [x] Works in both themes; fits its container (portal panel, invoice "Archivo" tab, receipts).
- [x] Tests: toolbar state (page bounds, zoom steps) with pdf.js mocked; `onDownload` called.

#### Package 3.7 — Wave 2 decisions and carry-over (DT-66, DT-67, n1, n2)

Package 3.7 → Agent: wedevs-developer · sonnet — Reason: touches the money-critical rate selection (C15, ≥ 90 % coverage) and the auth matrix (C13).

Files: `src/lib/rates.ts`, `src/lib/rates.test.ts`, `src/server/auth/permissions.ts`,
`src/server/auth/permissions.test.ts`, `src/lib/validators/zod-config.ts` and its test,
`eslint.config.mjs`. No i18n files.

- [x] **DT-67** `lib/rates.ts`: `RateRow` gains `source: RateSource` (from `@/lib/validators/enums`)
      and `createdAt: string` (ISO). `SelectedRate` gains `source: RateSource | null` and
      `options: RateOption[]`, where `RateOption = { source; usdRate; createdAt }`. `selectRate` picks the
      effective date per §9.2 (exact, else the latest earlier date as a fallback, else `null`). It then
      returns every usable rate of that date and currency as `options`, ordered `BCV` first, then by
      `createdAt` descending. The selected `usdRate`/`source` is `options[0]`. USD returns
      `{ usdRate: "1", source: null, options: [] }`. Update the JSDoc, which today says "the first row
      wins".
- [x] Tests (≥ 90 % coverage kept): several sources on the exact date (BCV wins; without BCV the most
      recent `createdAt` wins); several sources on the fallback date; non-positive rows excluded from
      `options`; USD.
- [x] **DT-66 / m3** `permissions.ts`: `activity` grants only `read` to Owner and Admin, and nothing to
      Member or Viewer. Update the JSDoc with the action vocabulary (DT-66). The matrix test asserts that
      `create`/`update`/`delete`/`restore` on `activity` are denied for every role.
- [x] **n2** `zod-config.ts`: `invalid_type` with `input === null` or `undefined` maps to
      `validation.required`. Test with a nullable-cleared enum/select field.
- [x] **n1** `eslint.config.mjs`: `no-restricted-imports` also blocks `zod/*` subpaths (pattern),
      with the same exceptions (`src/lib/validators/zod.ts`, `zod-config.ts`). Verify by linting a scratch
      import (and remove it).

#### Package 3.8 — Wave 3 review fixes (B1–B3, M1)

Package 3.8 → Agent: wedevs-developer · sonnet — Reason: portal security contract (C22), masking of financial identifiers (C5) and i18n of shared kit components (C1).

Use the shadcn MCP.

Files: `src/lib/validators/shares.ts`, `src/lib/validators/accounts.ts` and their tests;
`src/components/ui/data-table/{data-table-faceted-filter,data-table-filter-chips}.tsx`;
`src/components/patterns/{kpi-card,related-mini-table}.tsx`;
`src/components/ui/async-combobox/async-combobox.tsx`; tests next to them;
`src/i18n/messages/{es,en}/{table,forms,patterns}.json`. No other file.

- [x] **B1 (C22)** `shares.ts`: split every portal input in two.
      - A **client action schema** with only `{ token, documentId[, key] }`.
      - A **service input** type or schema that the adapter extends with server-only metadata:
        `unlockedDocumentIds` from the signed cookie, `ipHash` (or `ip`) and `userAgent`. This covers
        `resolveShareToken`, `getSharedDocument`, `recordShareAccess` and `unlockSharedDocument`. The C22
        lockout (5 failures per link, document and IP hash in 15 min) must be keyable from the service
        input.
      - Document that only the service schema reaches services.
      - Tests: the client schemas strip or reject `unlockedDocumentIds`, `ip` and `ipHash`; the unlock
        service input carries the IP hash.
      - Keep the existing export names working, or note every rename in `worker_done`.
- [x] **B2 (C5)** `accounts.ts`: a value counts as already masked only when it matches the exact output
      shapes (`^•••• \d{4}$`, `^.{4}….{4}$`, `^.….$`, all `•`). Anything else has its mask characters
      stripped and is masked again. Tests: each accepted shape, plus a bypass input such as
      `*0102-0123-45-6789012345`, which must come out masked.
- [x] **B3 (C1)**:
      - The date-range facet `<Calendar>` gets the active locale (`es`/`enUS`), the same way
        `date-field.tsx` does.
      - Filter chips format date ranges with `formatDate`, and build the label and range through ICU
        messages in `table`, not `"{label}:"` / `" – "` in code.
      - Move these composed labels into ICU messages in es and en:
        - `kpi-card.tsx` `${label} · open`;
        - `async-combobox.tsx` `${config.label}: ${option.label}`;
        - the `+ ` prefix in `related-mini-table.tsx`.
      - Tests: an ES calendar renders Spanish month names; a chip shows a localized range.
- [x] **M1 (a11y)** `kpi-card.tsx`: the link gets a visible focus ring (`focus-visible:ring-[3px]
      ring-ring/50` or equivalent). The accessible name includes the KPI value, or the `aria-label` is
      dropped so the content is read.

#### Wave 3 close

- [x] **Integration checklist:** 3.1–3.7 merged (3.8 follow-up below); no Claude attribution; worktrees removed; lint,
      typecheck, tests, `i18n:check`, build pass. Merges: 3.7 0bbffa5, 3.5 278b7f5, 3.6 d0791fb, 3.3 8ac969f,
      3.2 b4a64fe, 3.4 013505b, 3.1 b036177. Integrated: 57 files / 1303 tests; i18n parity 32 namespaces;
      build OK.
- [x] **Planner coherence review:** service names in contracts = PRD §12 (+ portal additions); DTO money
      fields are strings; multi-rate invoice contract matches C17; share read DTOs never expose keys;
      3.1/3.2 do not cross-import; kit props match `listQuerySchema` and `files.ts`; namespaces filled in
      both languages; 3.4 `RateLookupResult` is structurally identical to 3.7 `SelectedRate` (DT-67).
      Planner: READY FOR CODE REVIEW, no blockers. Majors → follow-up package 4.3 (wave 4): M1 data-table
      facets (`filters[id]`) vs module filter schemas (top-level fields) — bridge `toModuleQuery`; M2
      `rateLookupDtoSchema` ≠ `SelectedRate`; M3 column preference ↔ `ColumnConfig` converters + one width
      range; M4 shared helpers duplicated with different rules in `tags.ts`/`catalogs.ts` → `common.ts`;
      M5 `exportCsv` contract undelivered (coverage-matrix). Minors: m1 3.2 service type maps → H1-B3;
      m2 sort whitelist on 3.2 filters; m3 IVA adjustment on rate 0; m4 `settings.validation` kept by its
      later owner; m5 `ProjectsService` financials type param; m6 `documents.validation.*` keys missing.
      Deviations accepted: 3.7 (a)(b), 3.5 `window.confirm` (H1-FX may restyle), 3.2 (1)(2)(4)(5), 3.1
      (2)(3). 3.6 real PDF render deferred to H1-B4. nuqs adapter covered by 5.1. Open for the user:
      IGTF single source (proposed DT-70) and Technology `nameEn` (Δ4 or drop; before H2-B1).
- [x] **Code review:** C1, C2, C3, C5, C6, C8, C13, C15, C20 (`activity` read-only), C22 shape (contracts), C23 shape, C25.
      First pass CHANGES REQUIRED: B1 portal input schemas mix client and server-only fields
      (`unlockedDocumentIds`, `ip`) and the unlock contract lacks an IP for the lockout (C22); B2 account
      mask bypass (C5); B3 calendar without locale and composed labels in code (C1); M1 KPI card focus
      ring and accessible name → package 3.8. Planner M1–M5 / m1–m6 confirmed (4.3).
      Carried to 4.3: M2 export includes the `select` column; m1 facet search by label (`keywords`);
      m2 async facet error handling and debounce; m3 width input draft; m4 deviation warning formatting;
      m6 `ConfirmDialog` reset on open and `useId`; m9 combobox fallback name and `onCreate` error;
      m12 pagination clamp. Carried to H1-FX: m5 extra decimals in MoneyInput; m7 `aria-sort` and
      row label; m8 ToggleGroup of links → ButtonGroup + `aria-current`; m10 dial `aria-label`.
      H1-B4: m11 verify the pdf.js worker under Turbopack. Nits n1 (`logActivity` signature) and
      n2 (document the server-only salt) → 4.3.
      Second pass after 3.8 (merge 0dc22ec): READY FOR TESTING; B1–B3 and M1 fixed; C1, C2, C5, C6,
      C22 shape, C25 PASS. New M3 → 4.3: remove the legacy `shares` `*InputSchema`/`*Input` aliases
      that point at service schemas (risk of a portal action parsing client input with them).
- [x] **User confirms the Tester may run.** Confirmed 2026-10-10 ("procede").
- [x] **Tester scope:** `vitest run --coverage` (contracts, kit component tests), `i18n:check`, build,
      a11y spot-check of kit components (labels, keyboard on combobox, date field, PDF toolbar). No E2E.
      Tester (haiku, 2026-10-10, no commits): install, coverage, i18n:check, build, lint, typecheck all
      PASS. 59 files / 1321 tests, 0 failed. Gate: money.ts 100/100, rates.ts 97.44/96.43 (stmts/branches).
      Not gated: validators 99.9, money-input 95.0, rate-input 92, async-combobox 91.2, country-combobox
      100, date-field 92, phone-input 89.2, uploader 78.9, data-table 73.8, pdf-viewer 78.6, patterns 51.
      A11y: no blocker or major, 8 minors. No pdf.js worker asset in the build (expected, H1-B4).
- [x] **Problem report** (explicit, per agent).
      - Developers 3.1–3.7: review findings fixed in 3.8 (B1–B3, M1); the rest routed to 4.3, H1-FX,
        H1-B3 and H1-B4 as recorded under Planner coherence and Code review.
      - Tester, nothing blocking. Routed to 4.3: coverage `include` lists the non-existent
        `src/lib/finance/**` and gates only money/rates; tests for the 15 untested patterns
        (archived-banner, confirm-dialog, date-text, detail-header, empty-state, entity-code-chip,
        financial-summary-card, form-page, money-text, overview-layout, overview-table-toggle, page-header,
        section-card, side-panel-card, stat-card), data-table faceted-filter (19.6 %) and export-button
        (33.3 %), uploader and phone-input below 90 %; keyboard tests for country-combobox and date-field;
        a11y minors: faceted-filter `CommandInput` without `aria-label`, async-combobox and date-field
        without an i18n default name, hard-coded `id="table-show-archived"` (duplicate ids with two
        tables), uploader hidden file input left in the accessibility tree. Routed to H1-B4: pdf-viewer
        zoom-reset name vs visible value (WCAG 2.5.3), fullscreen `aria-pressed` with a changing label,
        `pdf-viewer.tsx` dynamic wrapper untested. Note only: country-combobox `name` variant relies on
        visible text.
- [x] **Summary.** Wave 3 delivered the contract layer (25 validator modules with service type aliases,
      schema factories for finance), the shared UI kit (data-table, forms kit with the DT-67 rate source
      selector, patterns, pdf-viewer) and the rates/permissions/zod-config updates (DT-66, DT-67). It
      went through a fix package (3.8) after review; the Tester found no failures.
      Open for the user: DT-70 (IGTF single source) and Technology `nameEn` (Δ4 or drop, before H2-B1).

🛑 **MANDATORY STOP** — wave 4 does not start without the user's explicit approval.

---

### WAVE 4 — Mock-layer foundation, action adapters and CI

**Objective:** the mock store and the service seam every module will plug into (DT-32, DT-37), catalog
fixtures, preferences/catalog/files/session actions, both action adapters, and the CI workflow.

**Shared-file owners (wave 4):**

| Shared file / area | Owner |
|---|---|
| `src/mocks/**` (except `session.ts`, read-only) | 4.1 |
| `src/server/context.ts`, `src/server/actions/define-action.ts`, `src/server/actions/define-public-action.ts` | 4.1 |
| `src/features/{shell,preferences,catalogs,files,session}/{queries,actions}.ts` | 4.1 |
| i18n namespace `mock` | 4.1 |
| `.github/workflows/ci.yml` | 4.2 |
| `src/lib/validators/**` except `preferences.ts`; `src/lib/csv.ts`; i18n namespace `documents` | 4.3 |
| `src/lib/validators/preferences.ts`, `src/lib/table-query.ts`, `src/components/ui/{data-table,async-combobox,date-field,uploader,rate-input}/**` (source), `src/components/patterns/confirm-dialog.tsx`; i18n namespaces `table`, `forms`, `patterns` | 4.4 |
| New test files only: `src/components/patterns/*.test.tsx` (14 patterns listed in 4.5), `src/components/ui/{country-combobox,date-field,phone-input}/*.keyboard.test.tsx` / `*.coverage.test.tsx` | 4.5 |
| `package.json` / lockfile, `vitest.config.ts` | nobody |

**Cross-package rule (wave 4):** 4.3 and 4.4 keep every existing export name of the files they edit
(re-export when a helper moves), so 4.1's imports keep compiling after the merge.

#### Package 4.1 — Mock store, service context, action adapters and foundation features

Package 4.1 → Agent: wedevs-developer · sonnet — Reason: defines the service seam signatures (`ctx`, `defineAction`, `definePublicAction`) that every module, the portal and the Hito 2 swap depend on (shared signatures, C9–C11).

Files: `src/mocks/store.ts`, `src/mocks/ctx.ts`, `src/mocks/ids.ts`, `src/mocks/fixtures/catalogs.ts`,
`src/mocks/fixtures/{clients,contacts,projects,billing,invoices,payments,accounts,expenses,documents,shares,notes,activity}.ts`
(typed empty stubs), `src/mocks/services/{catalogs,preferences,files,session}.ts`,
`src/server/context.ts`, `src/server/actions/define-action.ts`,
`src/server/actions/define-public-action.ts`, `src/features/shell/queries.ts`,
`src/features/preferences/{queries,actions}.ts`, `src/features/catalogs/{queries,actions}.ts`,
`src/features/files/actions.ts`, `src/features/session/actions.ts`,
`src/i18n/messages/{es,en}/mock.json`, tests next to each file.

- [x] `store.ts` (`// MOCK`): `globalThis` singleton, lazily built from fixtures, one typed collection per
      model the UI needs (incl. `invoiceTaxLines` and share-document key hashes as Δ1/Δ2 shapes);
      `resetMockStore()`; a `derive` hook list for later packages (`data-rules.md` §2).
- [x] `ids.ts`: stable readable ids and a mock sequence per prefix (`CLI`, `PRY`, `FAC`, `PAG`, `GAS`,
      `DOC`).
- [x] `fixtures/catalogs.ts`: currencies (USD, VES, EUR, USDT, COP), exchange rates for the last ~90
      days (VES around 755.16, with one missing business day), payment methods, document categories and
      types (§8.9.1), expense categories (§8.8), ~60 technologies, tags, fiscal settings with `ivaRates`
      `["16","8","0"]` and default 16, company settings, mock users. Every row parses with its Zod schema.
- [x] Module fixture stubs: typed empty arrays under stable names (owned later by module packages).
- [x] `ctx.ts` + `server/context.ts`: `getServiceContext()` → `{ db, user, now }` and
      `getPublicServiceContext()` → `{ db, user: null, now }` (C11).
- [x] `define-action.ts`: `defineAction({ permission, input, revalidate, handler })` — session →
      `can()` → Zod → handler(ctx, data) → revalidate → `ActionResult`; maps domain errors; never throws
      to the client (C10).
- [x] `define-public-action.ts`: `definePublicAction({ input, handler })` — resolve share token through a
      `resolveToken` function supplied by the shares module (generic `NOT_FOUND` on failure, no reason) →
      Zod → handler(publicCtx, { shareLink, data }) → `ActionResult`; never reads the session (C10
      exception). Unit-tested with a stub resolver.
- [x] Mock services (`fn(ctx, input)`): catalogs (`getRateFor`, `listCurrencies`, `listPaymentMethods`,
      `listTechnologies`, `listDocumentTypes`, `listExpenseCategories`, `listTags`, `getFiscalSettings`),
      preferences (get/set `table:<id>:columns`, theme, timezone), files (`requestUpload` returning a mock
      file id and no upload URL, `confirmUpload`), session (`setMockRole`, `resetMockData`).
- [x] Features: `shell/queries.ts#getShellData()` (user, latest VES rate with date and missing flag,
      alert count `0` until H1-B2), `preferences` queries/actions, `catalogs` queries + read actions
      (`lookupRateAction`), `files/actions.ts`, `session/actions.ts` (MOCK) — all through `defineAction`.
- [x] `mock` namespace strings in ES/EN.
- [x] Tests: `defineAction` order (`UNAUTHENTICATED`; Viewer on a write → `FORBIDDEN`, handler not
      called; bad input → `VALIDATION`; success → revalidate called); `definePublicAction` (unknown token
      → generic `NOT_FOUND`, no session access); store reset; fixtures parse; `getRateFor` fallback;
      ESLint import restrictions hold.
- **Notes from the wave 3 review (binding):**
  - `getRateFor` and `lookupRateAction` return `SelectedRate | null` from `src/lib/rates.ts` (DT-67), the
    shape `RateInput` consumes. Do not use `rateLookupDtoSchema` (4.3 realigns it in parallel).
  - Invoice/fiscal input schemas that need data are built with the 3.2 factories
    (`createInvoiceInputSchemaFor` etc.) from `getFiscalSettings().ivaRates`, never a hard-coded list.
  - Preferences store the column layout in the `preferences.ts` shape; 4.4 adds the converters to and
    from the kit's `ColumnConfig` in parallel — import the schema by name only.
  - Use the share **service** input schemas only inside services; `definePublicAction` parses the
    **action** schemas (C22, 3.8).

#### Package 4.2 — CI workflow (no database yet)

Package 4.2 → Agent: wedevs-developer · sonnet — Reason: CI workflows are critical by routing (`orca-workflow.md`).

Files: `.github/workflows/ci.yml`.

- [x] On pull requests and pushes to `main`: checkout, corepack + pnpm, Node from `.nvmrc`,
      `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`,
      `pnpm i18n:check`, `pnpm build`.
- [x] E2E job (Hito 1, mocks, no DB): install Playwright Chromium, `pnpm build`, start `next start` in the
      background with a readiness poll (fail after 60 s), `pnpm test:e2e --pass-with-no-tests`, always
      kill the server.
- [x] No secrets, no database, no deploy step, no Netlify/Neon calls. The Neon-testing-DB E2E (DT-46) is
      added in H2-B1. Concurrency group per branch.
- [x] Validate the YAML locally (e.g. `actionlint` if available; otherwise state that it was not run).

#### Package 4.3 — Contract follow-ups from wave 3 (Planner M1-schema side, M2, M4, M5, m2, m3, m6; Reviewer second-pass M3, n1, n2)

Package 4.3 → Agent: wedevs-developer · sonnet — Reason: edits shared contracts every module and the portal import (helper consolidation, share schemas, multi-rate invoice rule, CSV export contract).

Files: `src/lib/validators/{common,tags,catalogs,invoices,shares,activity}.ts` and the 3.2 filter files
that need a sort whitelist (`catalogs,settings,billing,invoices,payments,accounts,expenses,dashboard,reports`),
new `src/lib/validators/export.ts`, new `src/lib/csv.ts`, new `src/lib/validators/validation-keys.test.ts`,
tests next to each, `src/i18n/messages/{es,en}/documents.json`. No other file.

- [x] **M4** Move the shared helpers into `common.ts` with one behaviour each: `timestampSchema` strict
      ISO, `hexColorSchema` 6 digits, `optionalText` nullish, one facet helper. `tags.ts` and
      `catalogs.ts` re-export them under their current names. Tests for each rule.
- [x] **m2** Add `withSortFields` (sort whitelist) to every 3.2 filter schema, as 3.1 does.
- [x] **M2** Align `rateLookupDtoSchema` to `SelectedRate` (`usdRate`, `source`, `isFallback`,
      `effectiveDate`, `options[{source, usdRate, createdAt}]`; a missing rate is `null`, not a nullable
      date). Add a compile-time assertion that `z.infer<typeof rateLookupDtoSchema>` and `SelectedRate`
      are mutually assignable.
- [x] **m3** `ivaAdjustmentSchema`: reject an adjustment on a rate whose base IVA is 0 (tax-line
      `ivaAmount` must stay ≥ 0). Test.
- [x] **M5 contract** `export.ts`: `exportCsvInputSchema = { entity, query: listQuerySchema, columns:
      string[] (non-empty, unique) }` (PRD `exportCsv(entity, filters, columns)`). `csv.ts`: pure
      `toCsv(rows, columns)` — RFC 4180 quoting, CRLF, UTF-8 BOM, and formula-injection guard (prefix `'`
      to cells starting with `= + - @` tab or CR). Money columns are written as decimal strings. ≥ 90 %
      coverage. The mock export **action** is out of scope (see the M5 note below).
- [x] **Reviewer M3 (second pass)** `shares.ts`: remove the legacy `*InputSchema` / `*Input` aliases that
      point at the **service** schemas (`unlockSharedDocumentInputSchema`, `resolveShareTokenInputSchema`
      and the like). Keep the `*ActionSchema` / `*ServiceInputSchema` names. Update the tests; list every
      removed name in `worker_done`.
- [x] **n1** `activity.ts`: one signature for `logActivity` — `(tx, input)` in the transaction (C8);
      fix the `ActivityService` type to match.
- [x] **n2** `shares.ts`: document that the IP-hash salt is server-only and never reaches the client.
- [x] **m6** Add `documents.validation.{signedAtNotAllowed,expiresAtNotAllowed,signedStatusNotAllowed}` in
      ES and EN. New `validation-keys.test.ts`: every `<ns>.validation.*` key exported by a validator
      exists in both languages.
- [x] Gate: lint, typecheck, test, `i18n:check`, build.

**M5 note (planning gap, recorded):** the coverage matrix places "export (`exportCsv`)" in H1-B1 as the
kit export over mock queries. No H1-B1 module has list data yet, so H1-B1 delivers the contract and the
serializer (4.3) and the kit side (`onExport` without display-only columns, 4.4). The generic
`exportCsvAction` with a per-entity registry of mock queries is added in **H1-B2 wave 1** with the first
module list (clients).

#### Package 4.4 — Kit follow-ups from wave 3 (Planner M1-kit side, M3; Reviewer M2, m1–m4, m6, m9, m12; Tester a11y)

Package 4.4 → Agent: wedevs-developer · sonnet — Reason: fixes shared kit components every screen uses (table query bridge, column preferences, accessibility) and owns the preferences contract they share.

Use the shadcn MCP.

Files: `src/components/ui/data-table/**`, `src/components/ui/async-combobox/**`,
`src/components/ui/date-field/date-field.tsx`, `src/components/ui/uploader/**`,
`src/components/ui/rate-input/rate-input.tsx`, `src/components/patterns/confirm-dialog.tsx` (+ its test),
`src/lib/validators/preferences.ts`, new `src/lib/table-query.ts`, tests next to them (existing test files
of these components may be edited), `src/i18n/messages/{es,en}/{table,forms,patterns}.json`. No other file.

- [x] **M1** `src/lib/table-query.ts`: `toModuleQuery(query, facets)` flattens `query.filters` into
      top-level fields and maps each date-range facet to its own keys. Add optional `fromKey` / `toKey` to
      the date-range facet config (default `<id>From` / `<id>To`). The facet descriptor type lives in
      `lib` (the kit imports it; `lib` never imports from `components`). Tests against
      `invoiceFiltersSchema` and `shareFilterSchema`.
- [x] **M3** One width range 80–1200 shared by the kit and `preferences.ts` (export the constants from
      `preferences.ts`). `columnConfigToPreference` / `preferenceToColumnConfig` in `column-config.ts`,
      round-trip tested. **m3** The width field keeps a local draft and commits on blur or Enter.
- [x] **Reviewer M2** Display-only columns (`select`, row actions) carry `meta.exportable === false` and
      never reach `onExport`. Test.
- [x] **m1** Faceted filter search matches the visible label (`keywords={[option.label]}`). **m2** Async
      facet: catch `loadOptions` rejection (error state, retry) and debounce the search.
- [x] **m12** Pagination clamps a hand-edited `page` beyond `pageCount` (send to the last page).
- [x] **m4** `RateInput` deviation warning formats the rate for the locale (`formatDecimalForInput`).
- [x] **m6** `ConfirmDialog` resets reason and checkbox when it opens; ids from `useId`. Same for the
      toolbar's `table-show-archived` id.
- [x] **m9** `AsyncCombobox`: default accessible name from i18n when no `id`/`aria-label`; a failing
      `onCreate` is caught and shown with a toast.
- [x] **Tester a11y:** faceted-filter `CommandInput` gets an `aria-label`; `DateField` default i18n name;
      the uploader's hidden file input is `aria-hidden` (the Browse button stays the only control).
- [x] **Coverage:** raise data-table (faceted-filter, export-button, view-options, toolbar, pagination)
      and uploader to ≥ 90 % statements with tests next to them.
- [x] Gate: lint, typecheck, test, `i18n:check`, build.

#### Package 4.5 — Kit test coverage (Tester gaps)

Package 4.5 → Agent: wedevs-developer · haiku — Reason: test-only package over finished components; no source or shared signature changes.

Files: new test files only — `src/components/patterns/{archived-banner,date-text,detail-header,empty-state,entity-code-chip,financial-summary-card,form-page,money-text,overview-layout,overview-table-toggle,page-header,section-card,side-panel-card,stat-card}.test.tsx`,
`src/components/ui/country-combobox/country-combobox.keyboard.test.tsx`,
`src/components/ui/date-field/date-field.keyboard.test.tsx`,
`src/components/ui/phone-input/phone-input.coverage.test.tsx`. No source file, no existing test file.

- [x] One test file per listed pattern: renders with ES and EN messages, key props, empty/edge states,
      accessible names; `patterns/**` aggregate ≥ 90 % statements (excluding `confirm-dialog`, owned by
      4.4).
- [x] Keyboard tests: country-combobox (open with Enter/ArrowDown, filter, select with Enter, Escape
      closes and returns focus); date-field (open, arrow navigation, Enter selects, Escape closes).
- [x] phone-input ≥ 90 % statements.
- [x] If a test exposes a source bug, do not fix it: mark the test `it.todo`/`it.fails` with a comment
      and report it in `worker_done`.
- [x] Gate: lint, typecheck, test.

**Coverage gate note:** `vitest.config.ts` keeps `src/lib/finance/**` on purpose (C17 calculators,
H1-B3; `conventions.md` §testing). The gate stays aggregate until DT-59 switches it to `perFile` in
H1-B3. Kit coverage is enforced by the package checklists above, not by the gate.

#### Package 4.6 — Wave 4 review fixes (Code Review B1; Planner M1, M2, m1–m3, m8; Reviewer m-a, m-b, m-c, m-f, m-h, nit)

Package 4.6 → Agent: wedevs-developer · sonnet — Reason: fixes the central authorization adapter (C10/C13), the shared service error type and shared filter contracts every module builds on.

Use the shadcn MCP (uploader).

Files: `src/server/actions/define-action.ts` (+ test), new `src/server/errors.ts` (+ test),
`src/server/context.ts`, `src/mocks/ctx.ts`, `src/lib/validators/{common,invoices,payments,expenses,export,preferences,files}.ts`
(+ tests), `src/lib/table-query.ts` (+ test), `src/features/catalogs/{queries,actions}.ts`, new
`src/features/catalogs/rate-lookup.ts`, `src/features/files/actions.ts`, new
`src/features/files/upload-adapter.ts`, `src/mocks/services/files.ts`, `src/mocks/fixtures/catalogs.test.ts`,
`src/components/ui/uploader/uploader.tsx` (+ tests), `src/i18n/messages/{es,en}/forms.json`,
`.github/workflows/ci.yml`, tests next to each. No other file.

- [x] **B1 (C10/C13)** `defineAction`: an empty any-of list never skips `can()`. Type the list as
      `readonly [ActionPermission, ...ActionPermission[]]`; at runtime an empty list → `FORBIDDEN` (or
      throw at definition). Only `"authenticated"` has no `can()` check. Test both.
- [x] **M1** 3.2 filter ids that the kit offers as facets accept one or many: `invoices`
      `clientId`/`projectId`/`tagId`, `payments` `clientId`/`accountId`/`methodId`, `expenses`
      `categoryId`/`accountId`/`projectId`/`tagId`, recurring-expense `categoryId` →
      `facetSchema(idSchema)`. `toModuleQuery` test with two values parses against `invoiceFiltersSchema`.
- [x] **M2** Move `ServiceError` (and its code type) to framework-free `src/server/errors.ts` (no
      `server-only`, no imports beyond `lib/validators/common`). `mocks/ctx.ts` and `server/context.ts`
      re-export it under the same name; `define-action.ts` and feature actions import from
      `@/server/errors`.
- [x] **m1** One `columnIdSchema` (from `preferences.ts`) used by `export.ts` columns.
- [x] **m2** Client adapters, one owner each: `features/catalogs/rate-lookup.ts` turns
      `lookupRateAction` into `RateInput`'s `(date, currency) => Promise<RateLookupResult | null>`;
      `features/files/upload-adapter.ts` implements `UploadAdapter` over the file actions (mock `put`
      no-op, `// MOCK` where it is mock-only). Tests.
- [x] **m3** `confirmUploadInputSchema` in `validators/files.ts`; used by the mock service and the action
      (drop the local type and the inline `z.object`).
- [x] **m8 tests** Catalog fixture tests parse technology and tag rows with their full DTO schemas
      (`active`, `createdAt`).
- [x] **m-a** `withSortFields` returns its real refined type (no cast to `T`), or the helper documents
      "derive with `pick`/`partial` from the base object" and a test proves the documented path works.
- [x] **m-b / m-c** `ci.yml`: workflow-level `NEXT_TELEMETRY_DISABLED: "1"`; pnpm via
      `pnpm/action-setup` (reads `packageManager`) before `setup-node` with `cache: pnpm`. Keep version
      tags: SHA pinning needs verified SHAs from GitHub (no network for agents) → H1-B1 batch close, when
      the remote is added (DT-69).
- [x] **m-f (WCAG 2.5.3)** Uploader Browse button: the accessible name contains the visible text; the
      caller's label goes to `aria-describedby` or is composed with it via ICU in `forms`.
- [x] **m-h** `getRateFor` query parses its input like its siblings.
- [x] **nit** `toModuleQuery`: ignore `__proto__`, `constructor`, `prototype` facet ids. Test.
- [x] Gate: lint, typecheck, test, `i18n:check`, build.

#### Wave 4 close

- [x] **Integration checklist:** 4.1–4.5 merged (4.6 follow-up below); no Claude attribution; worktrees removed; lint,
      typecheck, tests, `i18n:check`, build pass. Merges: 4.2 6f09c0a, 4.3 22f0655, 4.5 8013d8f,
      4.4 977c9ce, 4.1 43b49a9. Integration fixes by the Orchestrator (test-only): `table-query.test.ts`
      sort field → `issueDate` (4.3 sort whitelist vs 4.4 test); `async-combobox.test.tsx` debounce
      10 → 200 ms (flaky under host load). Integrated: 103 files / 1721 tests + 1 expected fail
      (4.5: country-combobox does not open on ArrowDown → H1-FX); i18n parity 32 namespaces; build OK.
- [x ] **Planner coherence review:** mock service signatures use validator types; context shapes = C11;
      `defineAction` / `definePublicAction` sequences = C10; fixture stubs exported under the names later
      batches will own; CI scripts exist in `package.json`; 4.1 still compiles against the 4.3/4.4
      contracts; `toModuleQuery` output parses with module filter schemas.
      Planner: READY FOR CODE REVIEW, no blockers. All checks PASS except `toModuleQuery` with 2+ values
      on 3.2 scalar id fields. Majors → fix package 4.6: M1 3.2 filter ids (`invoices` client/project/tag,
      `payments` client/account/method, `expenses` category/account/project/tag, recurring category) are
      scalar while the kit facets are always multi → `facetSchema(idSchema)`; M2 `ServiceError` lives in
      `src/mocks/ctx.ts` (deleted by C9) → framework-free `src/server/errors.ts`, re-exported. Minors:
      m1 export column id regex ≠ `columnIdSchema` (4.6); m2 client adapters `RateInput` ↔
      `lookupRateAction` and `UploadAdapter` ↔ file actions (4.6); m3 `confirmUploadInputSchema` (4.6);
      m4 rate-0 adjustment message key + calculator guard (H1-B3); m5 unused `CATALOG_MESSAGES.invalidColor`
      (H1-FX); m6 export entity enum incomplete (H1-B2 W1, `exportCsvAction` owner); m7 portal request
      metadata step in `definePublicAction` vs shares comment (H1-B4); m8 fixture tests use chip schemas
      only (4.6) and files-fixture ownership (H1-B2 plan). Deviations accepted: 4.1 (1)(3)(4 except
      `ConfirmUploadInput`)(5)(6), 4.3 money columns skip the CSV guard, 6-digit hex, alias removal (no
      importer left), 4.4 width 80–1200 and uploader label on Browse. 4.1 (3) `'authenticated'` permission
      is outside the `can()` matrix: limited to own preferences, reference reads and MOCK actions —
      proposed DT-71 for the user.
- [x] **Code review:** C1, C5, C7, C8, C9, C10, C11, C15, C22, C25; CI has no secrets or remote calls;
      kit accessibility fixes.
      First pass CHANGES REQUIRED: B1 `defineAction` any-of permission list `[]` fails open (skips
      `can()`) → 4.6. Planner M1, M2, m1–m8 confirmed. Minors → 4.6: m-a `withSortFields` casts away the
      refinement (`.pick()`/`.partial()` throw at runtime); m-b `NEXT_TELEMETRY_DISABLED` in CI; m-c CI
      pnpm setup via `pnpm/action-setup` + actions pinned by SHA; m-f uploader Browse name must contain
      the visible text (WCAG 2.5.3); m-h `getRateFor` query parses its input; nit `BASE_KEYS` hardening
      (`__proto__`, `constructor`, `prototype`). → H1-B4: m-d public adapter parses the token with
      `shareTokenSchema` before `resolveToken`; m-e public adapter never leaks a specific `NOT_FOUND`
      reason (C22). → H1-B2: m-g catalog list services filter inactive rows and take `(ctx, input)`;
      nit `toCsv` comment on money columns. → H1-FX: dead key `forms.uploader.inputLabel`; pagination
      clamp stable callback; async-combobox debounce test with fake timers. Notes: MOCK role cookie
      without `secure`, reset open to every role (DT-40 intent), no VIEWER mock user, upload FORBIDDEN
      check inside the handler (acceptable).
      Second pass after 4.6 (merge b08a2ff): READY FOR TESTING; B1, Planner M1, M2, m1–m3, m8 tests,
      m-b, m-c (SHA pinning deferred to the batch close, DT-69), m-f, m-h and the unsafe-keys nit fixed;
      m-a accepted as documented (pick/partial from the base object, tested). Integrated: 106 files /
      1741 tests + 1 expected fail. New nits → H1-FX: cast in `features/catalogs/rate-lookup.ts`;
      `withSortFields` comment wrongly lists `.extend()`. → Planner (next `.rules` update):
      record the `src/server/errors.ts` framework-free exception to "everything under `src/server/`
      imports `server-only`".
- [x] **User confirms the Tester may run.** Confirmed 2026-10-10 ("procede").
- [x] **Tester scope:** `vitest run --coverage`, `i18n:check`, build; dry review of `ci.yml` against
      `package.json` scripts; kit coverage per area (data-table, uploader, phone-input, patterns ≥ 90 %
      statements). No E2E yet.
      Tester (haiku, 2026-10-10, no commits): install, coverage, i18n:check, build, lint, typecheck all
      PASS. 106 files / 1741 tests + 1 expected fail (country-combobox ArrowDown `it.fails`). Gate:
      money.ts 100/100, rates.ts 97.43/96.42 (stmts/branches). Kit stmts: data-table 95.7, uploader 96.9,
      phone-input 100, patterns 93.6, all ≥ 90 %. Informational: validators 99.9, table-query 100, csv 100,
      server/actions 98.8, features 100, mocks 93.6. `ci.yml` dry review: no mismatch (all scripts exist,
      Node via `.nvmrc`, pnpm via `packageManager`, `--frozen-lockfile`, no secrets, no deploy).
      async-combobox test file 3 runs in a row: stable.
- [x] **Problem report** (explicit, per agent).
      - Developers 4.1–4.5: review findings fixed in 4.6; the rest routed to H1-B2, H1-B3, H1-B4, H1-FX
        and the Planner as recorded under Planner coherence and Code review.
      - Orchestrator: two test-only integration fixes (table-query sort field, async-combobox debounce).
      - Tester, nothing blocking. Routed to H1-FX: per-file below 90 % stmts — `data-table.tsx` 88.9,
        `patterns/related-mini-table.tsx` 50, `patterns/use-unsaved-changes.ts` 84.6; data-table branches
        87.7 %. Note only: `mocks/store.ts`, `mocks/test-helpers.ts`, `mocks/services/catalogs.ts` below
        90 % (not gated, mocks are replaced in Hito 2). The CI `e2e` job runs on every PR with
        `--pass-with-no-tests`; intended (batch-close flow step 3, DT-46).
- [x] **Summary.** Wave 4 delivered the mock data layer (store, fixtures, services), the server context
      and `defineAction` / `definePublicAction` wrappers (fail-closed permissions, framework-free
      `ServiceError`), feature adapters (shell, preferences, catalogs, files, session, rate lookup,
      upload), the CI workflow, contract follow-ups (sort whitelists, multi-value facets, `csv`/`export`)
      and kit follow-ups (`toModuleQuery`, a11y fixes, tests for every kit area). It went through a fix
      package (4.6) after review; the Tester found no failures.
      Open for the user: DT-70 (IGTF single source), Technology `nameEn` (Δ4 or drop, before H2-B1),
      DT-71 (scope of the `'authenticated'` permission).

🛑 **MANDATORY STOP** — wave 5 does not start without the user's explicit approval.

---

### WAVE 5 — Application shell, sign-in and settings/preferences

**Approved by the user 2026-10-10 ("procede").**

**Objective:** the navigable authenticated shell (DU-01 Hito 1 baseline) and the settings frame with
working preferences.

**Shared-file owners (wave 5):**

| Shared file / area | Owner |
|---|---|
| `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/(auth)/**`, `src/app/not-found.tsx`, `src/app/(app)/not-found.tsx`, `src/app/(app)/loading.tsx`, `src/app/(app)/dashboard/page.tsx` | 5.1 |
| `src/config/nav.ts`, `src/components/app/**` (except the three files created in wave 2) | 5.1 |
| i18n namespaces `nav`, `shell`, `auth`, `common`, `search` | 5.1 (**wiring leader**) |
| `src/app/(app)/settings/**`, `src/config/settings-nav.ts`, `src/features/settings/**`, i18n namespace `settings` | 5.2 |
| `package.json` / lockfile | nobody |

#### Package 5.1 — App shell, Cmd+K dialog, sign-in mock (wiring leader)

Package 5.1 → Agent: wedevs-developer · haiku — Reason: screens and layout composed from the existing kit, registry components and wave-4 queries.

Use the shadcn MCP.

Files: see the owners table (5.1 rows) plus tests in `src/components/app/`.

- [x] Root layout providers: `NextIntlClientProvider`, `ThemeProvider`, `NuqsAdapter`, `Toaster`,
      `TooltipProvider`.
- [x] `src/config/nav.ts`: every sidebar item and group of §7.1 with lucide icons per
      `frontend-patterns.md` §1a, i18n keys, route, and the `can()` resource used to hide it; also feeds
      breadcrumbs and Cmd+K navigation.
- [x] `(app)/layout.tsx` with registry `sidebar` (collapsible, icon mode, mobile sheet), topbar
      (breadcrumbs, search trigger with `⌘K`, BCV `RateChip`, `AlertsBell` with counter and empty panel,
      locale switcher, theme toggle, `UserMenu`), footer (copyright, version, "Mock data" badge; no
      "Respaldo diario", DT-48). Match wireframes 4.2/4.4 and the brand (DT-51).
- [x] `UserMenu` (MOCK parts marked): name/role, "View as role", "Reset mock data", sign out (→
      `/sign-in`).
- [x] `CommandMenu` (registry `command` in a dialog): `⌘K`/`Ctrl+K` and the trigger; navigation from
      `nav.ts`; quick actions filtered by `can()`; results area with an empty state until H1-B5.
- [x] `(auth)/sign-in/[[...sign-in]]/page.tsx` per wireframe 4.1 **without counters or any data**
      (DT-48); buttons navigate to `/dashboard` (mock). `(app)/dashboard/page.tsx` placeholder.
      Not-found pages in and outside the shell; `(app)/loading.tsx` skeleton.
- [x] Strings only from i18n (C1); logo from the wireframes (DT-51).
- [x] Tests: nav items hidden per role via `can()`; command menu opens with the shortcut.

#### Package 5.2 — Settings frame and preferences

Package 5.2 → Agent: wedevs-developer · haiku — Reason: settings screen over the existing preferences actions and kit.

Use the shadcn MCP.

Files: `src/app/(app)/settings/layout.tsx`, `src/app/(app)/settings/page.tsx`,
`src/app/(app)/settings/preferences/page.tsx`, `src/config/settings-nav.ts`,
`src/features/settings/components/**`, `src/i18n/messages/{es,en}/settings.json`, tests.

- [x] Settings layout with section navigation for all §8.15 sections, hidden per `can()` (users: Owner
      only). `/settings` redirects to `/settings/preferences`.
- [x] Preferences form: language, theme, time zone (default `America/Caracas`, stored as the `timezone`
      preference, DT-43) saved through `preferences/actions.ts`; language change also sets
      `NEXT_LOCALE` and refreshes; uses `FormPage` and the unsaved-changes guard.
- [x] Tests: form submits through the action; theme change applies.
- **Note:** `settings.json` already holds a `validation` block (3.2). Extend the namespace; keep
  `validation` intact.

#### Package 5.3 — Wave 5 coherence fixes (Planner M1–M3, m1–m5)

Package 5.3 → Agent: wedevs-developer · haiku — Reason: shell and settings screens over the existing kit, config and preferences action; no new service signature, no money or auth logic (`can()` is only read as a cosmetic filter, C13).

Use the shadcn MCP.

Runs alone, after 5.1 and 5.2 are merged (no other package in flight). For its duration it is the single
owner of the files below and of the i18n namespace `shell`; it may **add** keys to `search` (R1), and it
reads `nav`, `settings`, `auth`, `common`, `enums`, `mock` without changing them. Ownership confirmed by
the Orchestrator after the code review: the Files list is extended with
`src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` (R4/R12a), the new `src/app/(app)/[...missing]/page.tsx`
(R7) and `src/i18n/messages/{es,en}/search.json` (add-only, R1).

Files: `src/config/nav.ts` (+ `nav.test.ts`);
`src/components/app/{app-sidebar,command-menu,app-breadcrumbs,rate-chip,locale-switcher,theme-toggle,user-menu}.tsx`
and their tests (existing test files may be edited; new `app-breadcrumbs.test.tsx`, `rate-chip.test.tsx`,
`locale-switcher.test.tsx`, `theme-toggle.test.tsx` as needed); `src/app/(app)/layout.tsx`;
`src/app/(app)/settings/preferences/page.tsx`; `src/features/settings/components/preferences-form.tsx`
(+ its test); `src/i18n/messages/{es,en}/shell.json`. No other file — in particular not
`src/components/ui/**` and not `src/features/preferences/**`.

- [x] **M1** `SETTINGS_NAV_ITEM.resource = null`: every signed-in user sees Configuración in the sidebar
      footer and in Cmd+K (the settings frame already filters its sections with `can()`, so Member and
      Viewer land on Preferencias only). Update the comment. Tests: Member and Viewer see the entry; the
      existing per-role tests for module items still pass.
- [x] **M2** Cmd+K items filter on what the user reads: `CommandItem` `value` = the translated label
      (navigation and quick actions), the key kept as a `keywords` entry. Tests with ES messages: typing
      "factu" lists Facturas; typing "pago" lists "Registrar pago"; EN "invoices" still works.
- [x] **M3** One preference, one behaviour: the topbar `LocaleSwitcher` and `ThemeToggle` also persist
      through `setPreferenceAction({ key: "locale" | "theme", value })` after the local change (on
      `!ok` a toast with `common.errors.<code>`; the local change stays). `preferences/page.tsx` takes the
      initial `locale` from the active request locale (`getLocale()`, the cookie wins in Hito 1,
      frontend-patterns §15), not from the store. Tests: each switcher calls the action with the chosen
      value; the form's initial language equals the active locale.
- [x] **m1** Breadcrumbs under `/settings/<slug>` label the section with `settings.nav.<labelKey>` from
      `findSettingsSection` (ES: "WeDevs Core / Configuración / Preferencias"); other unknown segments
      unchanged. Test.
- [x] **m2** `RateChip` gets a `canManage` prop computed in `(app)/layout.tsx` as
      `can(shell.user, "read", "settings")`; it links to `/settings/rates` only when true and renders the
      same chip without a link otherwise. Tests for both.
- [x] **m3** Sidebar footer user block per wireframe 4.2 / frontend-patterns §2, below Configuración:
      avatar with initials, name, role (`enums.UserRole`), sign-out button (→ `/sign-in`, MOCK until
      Clerk); avatar only in icon mode. Registry items only (`avatar`, `sidebar` menu, `button`); move
      `initialsOf` out of `user-menu.tsx` as a named export and reuse it. Labels from existing keys
      (`shell.userMenu.*`, `auth.signOut`). Test: the block renders name and role and signs out.
- [x] **m4** `AppSidebar` passes translated `aria-label` and `title` to `SidebarRail` (new key
      `shell.sidebar.toggle`, ES "Mostrar u ocultar la barra lateral", EN "Toggle sidebar"); the rail
      spreads `...props` last, so no registry edit.
- [x] **m5** `PreferencesForm` back link → `/dashboard` (`/settings` redirects to the same page).
- [x] **R1 (review)** `command-menu.tsx`: `<Command label={t("dialogTitle")}>` and
      `<CommandList label={…}>` with a new `search.listLabel` (ES "Resultados de búsqueda", EN "Search
      results") — **extends** this package to `search.json` (es/en, add-only). Test: the combobox and
      listbox have the translated names.
- [x] **R2 (review)** Planner m4 is a C1 blocker; same fix (translated `aria-label`/`title` on
      `SidebarRail`).
- [x] **R3 (review)** Sidebar brand link gets `aria-label={tCommon("app.name")}` (named in icon mode).
      Test: collapsed sidebar, the link is reachable by name.
- [x] **R4 + R12a (review)** Sign-in page (**extends** Files: `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`):
      theme tokens (`bg-card`, `text-muted-foreground`, `bg-border`, …) instead of fixed `neutral-*`/
      `bg-white`, AA in both themes; right column wrapped in `<main>`.
- [x] **R5 (review)** Compose the Cmd+K dialog from registry `Dialog`/`DialogContent`/`DialogHeader`
      (sr-only)/`DialogTitle`/`DialogDescription` + `Command` with the title **inside** the content
      (no registry edit). Test: closed menu renders no heading; open dialog's name and description
      are its translated title/description and both nodes are inside the dialog.
- [x] **R6 (review)** `RateChip`: accessible name includes the visible text (drop the overriding
      `aria-label`; the link purpose goes in the tooltip/`aria-describedby`); with m2's non-link variant
      the chip stays keyboard-focusable so the date/fallback tooltip opens on focus. Test both variants.
- [x] **R7 (review)** In-shell not-found for unmatched URLs: new `src/app/(app)/[...missing]/page.tsx`
      that only calls `notFound()` (**extends** Files). Test or E2E note for the Tester: `/clients`
      renders the not-found inside the sidebar shell; `/`, `/sign-in`, `/settings/*` unaffected.
- [x] **R8 (review)** Settings footer link sets `aria-current="page"` when active.
- [x] **R9 (review)** The "results pending" note moves out of the listbox group (e.g. below the list or
      as a disabled `CommandItem`) so `listbox` holds only options/groups.
- [x] **R10 (review)** `PreferencesForm`: language and theme as registry `FieldSet` + `FieldLegend`,
      descriptions as `FieldDescription` linked to the control (`aria-describedby` for the time-zone
      select). Existing tests stay green.
- [x] **R11 (review)** `shell.alerts.counter` as ICU plural in ES and EN
      (`{count, plural, one {# alerta} other {# alertas}}`).
- [x] **R12b (review)** `UserMenu` reset confirm disabled while the transition is pending.
- [x] Gate: lint, typecheck, test, `i18n:check`, build. Integrated by the Orchestrator: the new catch-all
      made `/clients` a page route, so `use-unsaved-changes.test.tsx` got a justified eslint-disable for its
      deliberate native anchor (d33f71f). Then 115 files, 1785 tests + 1 expected fail, i18n parity, build OK.
      Worker deviations: `initialsOf` exported from `app-sidebar.tsx`; sign-in secondary text uses
      `text-foreground/70` because `--muted-foreground` is ~3.2:1 on the light card (token → H1-FX); R7 has no
      unit test (Tester checks `/clients` in-shell not-found).

#### Package 5.4 — Wave 5 Tester defects (D1–D5, skip link)

Package 5.4 → Agent: wedevs-developer · sonnet (`--effort high`) — Reason: D2 (React #418 hydration
mismatch) and D3 (in-shell not-found answering HTTP 200, likely streaming through `(app)/loading.tsx`)
need root-cause diagnosis across server/client rendering and Next 16 routing semantics, not a mechanical
edit; haiku is not enough for that. No money, auth or service-signature change.

Use the shadcn MCP.

Runs alone, after 5.3 and the wave 5 Tester are merged (no other package in flight). Chosen by the user
2026-10-10 ("Fix package 5.4 now"). For its duration it is the single owner of the files below and of the
i18n namespace `shell` (add-only for the skip link).

Files: `src/app/layout.tsx`; `src/app/(app)/{layout,loading,not-found}.tsx`;
`src/app/(app)/[...missing]/page.tsx`; `src/app/(app)/dashboard/page.tsx`;
`src/app/(app)/settings/**`; `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`;
`src/components/app/**` and their tests; `src/features/settings/**`; `src/features/shell/**`;
`src/i18n/messages/{es,en}/shell.json` (add-only); `tests/e2e/h1-b1-shell.spec.ts` (only to remove the two
`test.fail()` marks and to assert the skip link). No other file — in particular not `src/components/ui/**`,
not `src/hooks/**`, not `package.json`/lockfile, not `.gitignore`. If a fix truly needs a file outside this
list, stop and ask (`question`) instead of editing it.

Constraints: no persistent server and no browser in this worker (safeguards rule 1) — diagnose from source,
`pnpm build` output and unit tests; the Orchestrator re-runs the E2E afterwards (phases B and C).

- [x] **D1 (major)** Tablet 820×1180: the topbar must not overflow (today scrollWidth 1007 > 820; rate chip,
      alerts, language, theme and user menu off-screen in ES and EN). Make the topbar responsive at
      768–1023 px (e.g. icon-only Cmd+K trigger below `lg`, compact rate chip, breadcrumbs truncating
      with `min-w-0`, locale/theme folded into the user menu below `lg` — the worker picks the least
      invasive option and states it). All controls stay reachable and keyboard-operable; no horizontal
      page scroll at 768, 820 and 1024 px.
- [x] **D2 (major)** React #418 hydration mismatch on `/dashboard` and `/settings/preferences` (all locales;
      `/sign-in` is clean). Find the root cause (suspects: date/number formatting with a server vs client
      time zone or locale, `Date.now()`/`new Date()` during render, theme-dependent markup before mount,
      random ids) and fix it at the source — not with blanket `suppressHydrationWarning`. Name the cause
      in the report. Add a unit test where the cause is testable (e.g. fixed time zone formatting).
- [x] **D3 (major)** `/clients` and `/settings/preferences/x` render the in-shell not-found but answer
      HTTP 200. They must answer 404 while keeping the not-found inside the shell. Diagnose (suspect: the
      `(app)/loading.tsx` Suspense boundary commits the 200 before `notFound()` runs) and fix (e.g. move
      the loading boundary below the catch-all, or scope it to the routes that need it). `/`,
      `/sign-in`, `/dashboard` and `/settings/*` keep their current status codes. Verify with
      `pnpm build` route output and reasoning in the report; the E2E confirms.
- [x] **D4 (minor)** Escape from the command menu returns focus to the Buscar trigger (`command-menu.tsx`
      ~L62). Unit test it.
- [x] **D5 (minor)** Sign-in: the decorative network lines no longer run behind the subtitle (keep them
      decorative, `aria-hidden`, behind or clear of all text; legible in both themes).
- [x] **Skip link (WCAG 2.4.1)** A "Saltar al contenido" / "Skip to content" link, first focusable element
      of the authenticated shell, visible on focus, moving focus to the page content container (give it
      an `id` and `tabIndex={-1}`). Keys in `shell.json` ES and EN. Unit test it. (R14 — `<main>`
      placement — stays in H1-FX; do not restructure `SidebarInset`.)
- [x] **E2E spec** Remove `test.fail()` from the 404 and Escape-focus tests; add a skip-link assertion to
      the keyboard test. Run `pnpm exec playwright test --list` only (no server).
- [x] Gate: lint, typecheck, test, `i18n:check`, build. Commit messages without any Claude attribution.
      **Result (developer, sonnet, 2026-10-10):** D1 — below `lg` the Cmd+K trigger is icon-only (`lg:w-44`,
      `xl:w-64`, Kbd from `xl`), the rate chip drops its clock and shows its label as `sr-only`; nothing folded
      into the user menu (least invasive). D2 cause — `BreadcrumbSeparator` (`<li>`) was nested inside
      `BreadcrumbItem` (`<li>`): the HTML parser closes the outer `<li>`, so server markup ≠ client tree
      (#418 on every shell page with ≥ 2 crumbs); separators are now siblings. D3 — `(app)/loading.tsx`
      wrapped the catch-all in Suspense, committing HTTP 200 before `notFound()`; the skeleton moved to
      `components/app/page-skeleton.tsx` and is used by `dashboard/loading.tsx` and
      `settings/preferences/loading.tsx` only (side effect: `/settings` now answers a real 307). D4 — the Buscar
      button is now the `DialogTrigger` (Radix returned focus to a null trigger ref). D5 — the network svg sits in
      its own flex area between brand and headline. Skip link — `SkipLink` + `id="main-content"`.

#### Wave 5 close

- [x] **Integration checklist:** 5.1, 5.2 merged; no Claude attribution; worktrees removed; lint,
      typecheck, tests, `i18n:check`, build pass.
      Result: 111 test files, 1761 tests + 1 expected fail; i18n 32 namespaces in parity; build OK.
- [x] **Planner coherence review:** nav routes = PRD §11; settings sections = §8.15; shell uses
      `getShellData` (no mock imports in components); icons per §1a; namespaces filled in both languages.
      Planner (2026-10-10, read-only on 688a325): **READY FOR CODE REVIEW, no blockers**; three majors and
      five minors → fix package 5.3.
      PASS: `nav.ts` groups, items and routes = §7.1 and §11 (Inicio; Comercial, Finanzas, Conocimiento,
      Análisis; Configuración pinned to the footer), quick-action routes exist in §11; `settings-nav.ts`
      12 slugs = §11 `/settings/*` in §8.15 order, users Owner-only (`can(read, user)`), trash on
      `trash`; `(app)/layout.tsx` reads only `getShellData`; no file under `src/app/**`,
      `src/components/**` or `src/features/*/components/**` imports `@/mocks/**` (remaining importers are
      the C9-listed queries/actions); icons match §1a (`Cpu` technologies, `SlidersHorizontal`
      preferences, `Clock` rate chip, `Settings`, `LogOut`; `Users`, `Tags`, `Trash2`, `Percent`,
      `ArrowRightLeft`, `FolderTree`, `DollarSign` have no mockup symbol or follow the table — accepted);
      namespaces `nav`, `shell`, `auth`, `common`, `search`, `settings` filled in ES and EN with no
      English left in ES (the endonyms "English"/"Español" are intended); `settings.validation` intact;
      settings layout nested inside the `(app)` shell; `/settings` → `/settings/preferences`; 5.2 writes
      the same `NEXT_LOCALE` cookie as `LocaleSwitcher` and uses the same next-themes `setTheme` as
      `ThemeToggle`.
      Findings:
      - **M1 (major → 5.3)** Member and Viewer cannot reach their own Preferences: `SETTINGS_NAV_ITEM`
        uses resource `settings` (Owner/Admin only), which hides the sidebar and Cmd+K entries, and the
        user menu has no Preferences link — yet the settings frame offers Preferences to every role
        (§8.15 "por usuario").
      - **M2 (major → 5.3)** Cmd+K items use `value="nav <key>"` / `"action <key>"`, so cmdk filters on
        English keys: "Facturas" or "Registrar pago" typed in ES find nothing (§7.6, HU-30).
      - **M3 (major → 5.3)** Two writers of the same preference disagree: the topbar switchers change the
        cookie / local theme without saving the preference, while the Preferences form starts from the
        store; after a topbar switch the form shows the old language/theme and cannot save the one in
        use (§7.8 "se guarda por usuario").
      - **m1 (minor → 5.3)** Breadcrumbs print raw slugs under settings (`/settings/preferences` →
        "preferences" in the ES UI, C1). Labels for detail ids/codes → H1-B2 (first detail routes).
      - **m2 (minor → 5.3)** The rate chip links every role to `/settings/rates`, which is the in-shell
        not-found for Member/Viewer.
      - **m3 (minor → 5.3)** The sidebar footer lacks the user block of wireframe 4.2 /
        frontend-patterns §2 (avatar, name, role, sign-out).
      - **m4 (minor → 5.3)** `SidebarRail` keeps the registry's English `aria-label`/`title` "Toggle
        Sidebar" (visible tooltip, C1); fixable through props without touching the registry file.
      - **m5 (minor → 5.3)** `PreferencesForm` `backHref="/settings"` redirects back to the same page.
      Worker deviations:
      - **(a) ACCEPTED** `src/features/settings/queries.ts` lies inside the 5.2 owners-table row
        (`src/features/settings/**`); it is the C10/C11-shaped reader the layout and the `[section]` page
        need (`getServiceContext` + `can()`, no mocks). Same for `src/app/(app)/settings/[section]/page.tsx`
        (placeholder for the 11 later sections, inside `src/app/(app)/settings/**`).
      - **(b) ACCEPTED** code-drawn "W": the repo has no logo asset; the mockups load the mark from an
        external hosted image (not usable: no remote assets, CSP), and frontend-patterns §1 defines the
        logo as the black circular "W" + "WeDevs Core" as drawn in the wireframes, which `BrandMark`
        reproduces (with a dark-mode inverse). A user-supplied SVG can replace it in H1-FX.
      - **(c) ACCEPTED** the `sidebar.tsx` edit is i18n of built-in strings, allowed by
        frontend-patterns §0 rule 4 (C3) and reported; the `<Command>` wrapper is required because this
        registry version's `CommandDialog` does not wrap its children. Code Review: confirm the dialog's
        title/description wiring in the a11y pass.
      - **(d) ACCEPTED** the chip's target route exists through 5.2's `[section]` placeholder and matches
        frontend-patterns §1; only the per-role link is wrong (m2).
      Notes: the topbar persistence in M3 uses the existing `setPreferenceAction` (`'authenticated'`, own
      preferences only), within proposed DT-71 — still to be recorded by the user with DT-70. Code Review
      may run on 688a325 now and its findings be folded into 5.3 before dispatch (as in wave 4), or after
      5.3 merges; the Orchestrator declares which.
- [x] **Code review:** C1, C2, C3, C5, C6, C7, C9, C10, C25; accessibility of sidebar, topbar and
      command menu.
      Code Reviewer (2026-10-10, read-only on 688a325; tsc, lint, `i18n:check` re-run: PASS):
      **BLOCKED until 5.3 merges** — two C1 blockers and two WCAG AA failures, all point fixes folded
      into 5.3 as "(review)" items; no item 4–10 invariant broken.
      PASS: C2 parity (32 namespaces); C5 no secrets or real data in the wave diff; C6 no attribution in
      `git log main..HEAD` or files; C7/C9 no `@/mocks`, Prisma or data source under `src/app/**`,
      `src/components/**`, `src/features/*/components/**`, `src/config/**`; C10 the shell mutates only
      through `defineAction` actions (`setPreferenceAction`, `setMockRoleAction`, `resetMockDataAction`),
      no new action; `can()` gates every nav item, quick action, settings section and `[section]` page
      (server-side for settings); no `next/*` in services; rate chip formats the decimal string with
      `roundMoney` + `Intl` (no `Number`/`parseFloat`); C25 each package stayed in its owners row
      (`ui/sidebar.tsx` i18n edit accepted by the Planner, (c)). Agrees with Planner M1–M3, m1–m3, m5.
      Findings:
      - **R1 (BLOCKER, C1 → 5.3)** cmdk's own English/empty a11y strings reach the UI:
        `command-menu.tsx:71` `<Command>` has no `label`, so the combobox input is labelled by an empty
        cmdk `<label>`; `:73` `<CommandList>` keeps cmdk's default `aria-label="Suggestions"` in the ES UI
        (verified in jsdom).
      - **R2 (BLOCKER, C1 — upgrades Planner m4)** `SidebarRail` English `aria-label`/`title` "Toggle
        Sidebar" (`app-sidebar.tsx:96`, `ui/sidebar.tsx:289,292`) is a hardcoded user-facing string; same
        fix as m4, but it gates Testing.
      - **R3 (BLOCKER, WCAG 4.1.2/2.4.4 → 5.3)** In icon mode the sidebar brand link has no accessible
        name: `BrandMark` is `aria-hidden` and the name `<span>` is `display:none`
        (`app-sidebar.tsx:59-64`).
      - **R4 (BLOCKER, WCAG 1.4.3, PRD §14 "AA in both themes" → 5.3)** Sign-in uses fixed neutral
        colours instead of theme tokens: `text-neutral-400` "o" on white ≈ 2.6:1
        (`sign-in/[[...sign-in]]/page.tsx:72`); dark theme `text-neutral-500` subtitle and verification
        note on `neutral-950` ≈ 4.2:1 (`:64`, `:95`).
      - **R5 (major → 5.3)** Planner (c) check: the registry `CommandDialog` renders `DialogHeader` with
        `DialogTitle`/`DialogDescription` **outside** `DialogContent` (`ui/command.tsx:50-54`). The
        dialog's `aria-labelledby` points out of the dialog, and while closed every page carries a hidden
        `<h2>` "Menú de comandos" + description in the topbar before the page `h1` (verified in jsdom).
      - **R6 (major → 5.3)** `RateChip` link `aria-label` "Gestionar tasas de cambio" replaces the visible
        "Tasa BCV 1 USD = Bs. …", so assistive tech never hears the rate (WCAG 2.5.3 label-in-name,
        1.3.1) (`rate-chip.tsx:37`). With m2 the non-linked chip must stay focusable or the tooltip
        (date / fallback) is unreachable by keyboard.
      - **R7 (major → 5.3)** Unmatched URLs inside the shell render the root not-found **without** the
        shell (App Router sends unmatched URLs to `src/app/not-found.tsx`; `(app)/not-found.tsx` only
        catches `notFound()` calls). Every sidebar module and Cmd+K quick action not built yet
        (`/clients`, `/invoices/new`, …) leaves the shell, against frontend-patterns §2 "Unknown routes
        inside `(app)` render an in-shell not-found page".
      - **R8 (minor → 5.3)** Settings footer link lacks `aria-current="page"` (module items have it)
        (`app-sidebar.tsx:87`).
      - **R9 (minor → 5.3)** `<p>` pending note directly inside the `listbox` group (non-option child)
        (`command-menu.tsx:105-109`).
      - **R10 (minor → 5.3)** `preferences-form.tsx:107-108,133-134,159-160`: hand-written `<p>`
        descriptions not associated with their control; the registry `field` provides `FieldSet` /
        `FieldLegend` (radio groups) and `FieldDescription` (C3).
      - **R11 (minor → 5.3)** `shell.alerts.counter` has no ICU plural ("1 alertas" / "1 alerts").
      - **R12 (minor → 5.3)** Sign-in page has no `<main>` landmark (`page.tsx:22`); the reset-mock
        confirm is not disabled while pending (double submit, `user-menu.tsx:156`).
      - **R13 (→ Planner, `.rules` update, no code now)** `src/config/nav.ts:18-23` and
        `settings-nav.ts:16` bundle `src/server/auth/permissions.ts` into client components; it has no
        `server-only` (conventions Part B "everything under `src/server/` imports `server-only`").
        Record it as a framework-free exception next to `src/server/errors.ts`, or move the pure matrix
        to `src/lib/`. It is cosmetic filtering only (C13); the matrix is already public in the PRD.
      - **R14 (→ Planner / H1-FX)** Registry `SidebarInset` is a `<main>` that wraps the topbar `<header>`
        and the `<footer>`: no banner/contentinfo landmarks and "main" starts at the topbar
        (`(app)/layout.tsx:21-35`). Fixing it needs a registry edit beyond C3's theming/i18n allowance.
      - **R15 (→ H1-FX)** No title template: every in-shell page is titled "WeDevs Core" (WCAG 2.4.2;
        `src/app/layout.tsx:14-17`); module batches add per-page `generateMetadata`.
      - **R16 (→ H1-B2)** Alerts counter badge `text-white` on dark-theme `bg-destructive` at 10 px is
        likely below 4.5:1; check when the counter is non-zero.
      - Notes (no action): `⌘K` hint shown on Windows/Linux too (`search.shortcut`); footer and sign-in
        year from `new Date()` instead of the Caracas date (only wrong for a few hours on 31 Dec UTC).
      Second pass (2026-10-10, read-only on b75c46c, 5.3 = `bfc54e9..b75c46c`; tsc, lint, `i18n:check`,
      vitest on `components/app`, `config`, `features/settings`, unsaved-changes: PASS; jsdom probe for
      R1/R5/R6): **READY FOR TESTING.**
      Verified fixed: M1 (`SETTINGS_NAV_ITEM.resource = null`, Member/Viewer tests); M2 (`value` = label,
      key in `keywords`, ES "factu"/"pago" and EN "invoices" tests); M3 (both switchers call
      `setPreferenceAction`, toast on `!ok` with the local change kept; preferences page reads
      `getLocale()`); m1 (settings slug labelled from `settings.nav`); m2 (`canManage` from
      `can(shell.user, "read", "settings")` in the layout); m3 (sidebar user block, avatar only in icon
      mode); m4/R2 (translated rail label and title); m5 (back → `/dashboard`); R1 (input named "Menú de
      comandos", listbox "Resultados de búsqueda"); R3 (brand link named); R4/R12a (theme tokens,
      `<main>`); R5 (closed menu renders no heading; title and description inside the dialog); R6
      (accessible name = visible text, description merges the link purpose and the tooltip; non-link chip
      focusable); R7 (route manifest: `/[...missing]` alongside `/`, `/dashboard`, `/settings`,
      `/settings/[section]`, `/settings/preferences`, `/sign-in/[[...sign-in]]` — static and more specific
      routes win, `/` needs zero segments, so nothing is shadowed; the root not-found remains for
      `notFound()` outside `(app)`); R8–R11, R12b. No `@/mocks`/Prisma in components, no attribution, no
      secrets; scope = 5.3 list plus the declared extensions and the Orchestrator's test-only d33f71f.
      Worker deviations: `initialsOf` in `app-sidebar.tsx` **ACCEPTED** (same component bundle; a pure
      helper could later move to `src/lib/`, H1-FX nit); sign-in `text-foreground/70` **ACCEPTED**
      (≈7:1 light, ≈8:1 dark); R7 without unit test **ACCEPTED** (route file only calls `notFound()`;
      covered by the route manifest and the Tester's E2E below).
      Remaining findings (none gates Testing):
      - **N1 (major → Planner, design decision; resolve before H1-B1 closes)** Light-theme
        `--muted-foreground` `#8e8e9a` (`src/app/globals.css:74`) fails WCAG 1.4.3 on every light surface:
        3.24:1 on `--card`, 2.95:1 on `--background`, 2.75:1 on `--muted`. 86 usages, including the
        shell on every page (footer, rate-chip label, sidebar role, form descriptions). Dark theme passes
        (5.05–6.07:1). Pre-existing (wave 1 token from the wireframes, P9), so it is a brand-vs-§14
        decision, not a 5.3 regression. `#686874` reaches ≥ 4.67:1 on all three light surfaces.
      - **N2 (minor → H1-FX)** No favicon or `public/`: `/favicon.ico` now falls into the catch-all and
        renders the full shell (`getShellData`) as a 404 on every page load. Add `src/app/icon.svg`
        (brand mark).
      - **N3 (note → Planner, Hito 2 auth)** The catch-all serves the authenticated `(app)` shell for
        any unmatched URL, including under future public prefixes (`/s/<token>/extra`, unknown `/api/*`).
        Hito 2's `proxy.ts` and the portal need their own not-found handling so a visitor without a
        session never reaches the `(app)` layout.
      - **N4 (nit → H1-FX)** Preference radio groups sit in `FieldSet`/`FieldLegend` (named group) but
        the inner `radiogroup` lost its own name; optional `aria-labelledby` to the legend.
      - Confirmed R16 → H1-B2: white on dark `--destructive` is 3.04:1 (counter badge).
      - Tester E2E additions: `/clients` and `/settings/preferences/x` render the in-shell not-found
        with status 404; `/`, `/sign-in`, `/dashboard`, `/settings/*` unaffected.
- [x] **User confirms the Tester may run.** Confirmed 2026-10-10. Same answer, N1 decided by the user:
      `--muted-foreground` (light theme) becomes `#686874` for AA (≥ 4.67:1 on card, page and muted
      surfaces); routed to H1-FX (`src/app/globals.css`), then drop the sign-in `text-foreground/70`
      workaround.
- [ ] **Tester scope:**
  - Unit: `vitest run --coverage`, `i18n:check`, build.
  - E2E (`tests/e2e/h1-b1-shell.spec.ts`, written by the Tester), local only, two workers per
    `safeguards.md` rule 1 (start worker: `next start` on a free port, poll with 60 s timeout; test
    worker: Playwright, then kill the server): `/` → `/dashboard`; `/sign-in` renders outside the shell
    with no counters and reaches `/dashboard`; every sidebar link resolves to a page or the in-shell
    not-found; Cmd+K opens and navigates; ES ↔ EN translates the shell and reformats the rate chip
    (HU-30 CA1); theme persists across reload; "View as Viewer" hides write quick actions; preferences
    (incl. time zone) save.
  - Accessibility and responsive: keyboard through sidebar/topbar/command menu; desktop and tablet;
    dark-mode contrast spot-check.
  - Manual pass (embedded browser): shell golden path in both themes and languages.
  - **Result (Tester, haiku, 2026-10-10, three phases per safeguards rule 1):**
    - Phase A (no server): install, i18n:check, build, lint, typecheck PASS. Coverage gate money.ts
      100/100, rates.ts 97.43/96.42. Full `test:coverage` hit 4–6 jsdom 5 s timeouts in
      country-combobox and phone-input under parallel load (all pass in isolation and in the
      Orchestrator's gate runs) → flaky, not a wave 5 regression. Shell scope (20 files, not gated):
      76.3 % stmts / 73.1 % branches; 0 % on user-menu, alerts-bell, app-footer, not-found-content,
      theme-provider, section-placeholder, settings-nav component, settings queries. E2E spec
      `tests/e2e/h1-b1-shell.spec.ts` written (15 tests, c1736b2).
    - Phase B: `next start` on :3105, ready in 2 s.
    - Phase C: 15/15 in two runs (2 marked `test.fail()` for known defects; spec-only fix 94d8aa4:
      hydration waits). Server stopped, port freed. Playwright 1.64 expects chromium-1248; the
      Tester symlinked the cached chromium-1243 in `~/.cache/ms-playwright` (outside the repo).
    - **Defects:**
      - **D1 (major)** tablet 820×1180: topbar overflows (scrollWidth 1007 > 820); rate chip, alerts,
        language, theme and user menu off-screen (ES and EN).
      - **D2 (major)** React #418 hydration mismatch on `/dashboard` and `/settings/preferences` (all
        locales); `/sign-in` clean.
      - **D3 (major)** R7: `/clients` and `/settings/preferences/x` render the in-shell not-found but
        answer HTTP 200, not 404 (`test.fail`).
      - **D4 (minor)** Escape from the command menu does not return focus to the Buscar trigger
        (`command-menu.tsx` ~L62) (`test.fail`).
      - **D5 (minor)** sign-in decorative network lines run behind the subtitle text.
    - Manual pass 1440×900 and 820×1180, light/dark × ES/EN: text translated, dark menus legible,
      focus rings visible; findings above. No skip-to-content link (WCAG 2.4.1) — not asserted.
    - **Fix package 5.4** (user chose "Fix package 5.4 now", 2026-10-10): integrated, gate green (116
      files, 1792 tests + 1 expected fail, i18n parity, build). Root causes: D2 nested `<li>` (breadcrumb
      separator inside the item); D3 `(app)/loading.tsx` Suspense above the catch-all (skeleton now only
      on dashboard and preferences; `/settings` became a real 307).
    - **Re-run (Tester, haiku, phases B and C, 2026-10-10):** `next start` on :3105; 16/16 PASS in two
      runs, no spec change, no `test.fail()`. D1 (no overflow at 768/820/1024, ES and EN), D2 (no
      hydration error on `/dashboard`, `/settings/preferences`, `/sign-in`, all locale/theme combos), D3
      (`/clients`, `/settings/preferences/x` → 404 in-shell), D4, D5 and the skip link verified. Server
      stopped, port freed. Minor visual notes → H1-FX: breadcrumb truncation at 820 px dark/ES; subtle
      topbar focus ring in dark mode.
- [x] **Problem report** (explicit, per agent).
      - Developers 5.1–5.2: Planner M1–M3, m1–m5 and review R1–R12 fixed in 5.3.
      - Developer 5.3: deviations recorded in its gate line (`initialsOf` export, `text-foreground/70` on
        sign-in).
      - Developer 5.4: Tester D1–D5 and the skip link fixed; no deviation outside its Files list.
      - Orchestrator: one test-only integration fix (justified eslint-disable in
        `use-unsaved-changes.test.tsx`, d33f71f).
      - Tester: defects D1–D5 (fixed by 5.4, verified by the re-run). Flaky, not gated: 4–6 jsdom 5 s
        timeouts in country-combobox and phone-input under full parallel coverage runs → H1-FX. Shell
        unit coverage 76 % stmts, 0 % on user-menu, alerts-bell, app-footer, not-found-content,
        theme-provider, section-placeholder, settings-nav component, settings queries → H1-FX.
        Environment: Playwright 1.64 expects chromium-1248; the cached chromium-1243 was symlinked in
        `~/.cache/ms-playwright` (outside the repo) — the user should run `pnpm exec playwright install`
        with network.
      - Routed: N1 (`--muted-foreground` → `#686874`), N2 (favicon), N4, R14, R15 → H1-FX; R16 → H1-B2;
        N3 → Hito 2 auth; R13 → Planner rules update.
- [x] **Summary.** Wave 5 delivered the authenticated shell (sidebar, topbar with Cmd+K, rate chip,
      alerts, locale and theme, user menu, footer, breadcrumbs, skip link), the sign-in mock, the in-shell
      not-found with real 404s, and the settings frame with working preferences. It went through a
      coherence fix package (5.3) and a Tester-defect package (5.4); the E2E re-run passed 16/16 twice.
      User decisions 2026-10-10 (`decisions.md` §11): DT-70 IGTF single source (drop `igtfMethodCodes` →
      H1-B3 finance packages); DT-71 `'authenticated'` scope; DT-72 Δ4 `Technology.nameEn` (H2-B1 schema);
      DT-73 P3 unknown, stays configurable; DT-74 P6 proposal accepted; DT-75 P7 no migration; DT-76 domain
      = Netlify URL; DT-77 secrets listed at H2-B1 start. Push/PR stays at the end of Hito 1 (DT-69).
      `.mcp.json` pin confirmed (`shadcn@4.21.4`, tracked in the repo). The user runs
      `pnpm exec playwright install` to replace the chromium symlink.

🛑 **MANDATORY STOP** — H1-B1 closes only with the user's explicit approval; then the batch-close steps
below.

### H1-B1 batch close

- [x] User approves the H1-B1 close after reviewing the UI locally with `pnpm dev` (2026-10-10: "todo en
      orden, procede").
- [x] `.mcp.json` pinned to `shadcn@4.21.4` (DT-49 / IOU-04), tracked in the repo — confirmed by the user.
- [ ] **Deferred to the end of Hito 1 (DT-69):** push `batch/h1-b1-ui-foundations`, open the PR, CI green,
      Netlify deploy preview (mock UI; DT-32), user merges to `main`. No agent merges. Until then H1-B2
      branches from `batch/h1-b1-ui-foundations`, not from `main`.

---

## H1-B2 — Commercial core UI

### Header

- **Objective:** the commercial core, navigable over mocks: clients and contacts; projects (several
  clients with roles, stack from the catalog, grouped links with drag reorder, status transitions);
  notes (Tiptap editor, entity feed, global table); `/activity` and the entity *Actividad* tab; tags and
  technologies settings; the shared cross-entity tabs (*Notas*, *Documentos*, *Actividad*); the nine
  alert rules with `AlertList`, a live bell counter and the bell panel list; CSV export of the H1-B2
  tables; breadcrumb labels for detail routes. At the close every H1-B2 route of PRD §11
  (`coverage-matrix.md` §4) renders inside the shell over one coherent mock dataset, mutations last for
  the server process, and HU-03…HU-08, HU-23 and HU-29 pass as local E2E over mocks.
- **Type:** phase batch — Hito 1, UI batch 2 of 5 (DU-01).
- **Base branch:** `batch/h1-b2-commercial-core`, created from the closed `batch/h1-b1-ui-foundations`
  at `6acc4d8` (DT-69: no push or PR until Hito 1 ends).
- **PRD sections implemented (UI over mocks):** §7.2 (detail), §7.3 (H1-B2 tables, CSV export, "Mostrar
  archivados"), §7.4 (forms), §7.5 (tags), §7.7 (archive and restore dialogs, the client cascade lock,
  the technology in-use lock), §7.9 (alert rules, `AlertList`, bell counter and panel list), §8.2, §8.3
  (without the billing plan), §8.10, §8.14, §8.15 (Tecnologías, Etiquetas); §12 services `clients`,
  `contacts`, `projects` (without `getProjectFinancials`, H1-B3), `notes`, `tags`, `activity`
  (`listActivity`; mock `logActivity`), `settings` technology CRUD, `export` (`exportCsv` mock seam),
  alerts (§7.9); and a minimal `documents` service (`listDocuments`, `createDocument` for files,
  `linkDocument`, `unlinkDocument`) that serves only the *Documentos* tab.
- **Decided stack:** `.rules/stack.md`. Every needed dependency is already installed (DT-38): Tiptap
  3.31.4, `@dnd-kit/*`, `simple-icons`, `diff`, `nuqs`, `cmdk`. **No package in this batch changes the
  lockfile.** Registry items not yet installed (`alert`, `item`, optionally `attachment`) are added only
  by package 1.3; their dependencies (`cn`, `radix-ui`) are already installed. Registry check with the
  shadcn MCP (`@shadcn`, 2026-10-10): there is **no** rich-text editor, timeline, colour picker or
  sortable list item. So the Tiptap editor, the activity timeline, the tag colour swatches and the link
  reorder are compositions of installed registry items (`toggle`, `toggle-group`, `button-group`,
  `separator`, `tooltip`, `popover`, `sheet`, `collapsible`, `badge`, `avatar`, `item`) with Tiptap and
  `@dnd-kit`. The registry block `dashboard-01` is the reference for `@dnd-kit` row reordering.
- **Binding invariants:** C1, C2, C3, C4 (Tiptap editor and renderer, link and image attributes), C5
  (fictional dataset, IPs from RFC 5737 documentation ranges), C6, C7, C8, C9, C10 (every action through
  `defineAction`, DT-71), C11, C12 (Hito 1 form: mock services append activity entries), C15 (USD
  aggregates as decimal strings through `lib/money`), C16 shape (client and project USD totals sum
  stored snapshots), C19 shape (archive/restore, client cascade lock, technology in-use lock, archived
  rows hidden unless asked), C20 shape (no edit or delete of activity anywhere), C23 shape (uploader in
  the attach sheet and note attachments), C25.
- **DT-71 (binding):** `permission: "authenticated"` only for: the caller's own preferences; reads of
  reference catalogs (technologies, tags, document types and categories, currencies…); MOCK-only
  actions; and — Planner interpretation, the Code Reviewer confirms — the caller's own alert dismissals
  and snoozes (per-user state, like preferences; PRD §7.9) — **confirmed by the user, DT-79**. Every other action and every read action
  over business records (client, contact, project, document, note search; activity) declares a `can()`
  grant.
- **User stories (UI part, over mocks):** HU-03 CA1–CA4 (CA4: the activity entry; the search index is
  H1-B5/H2-B2), HU-04 CA1–CA2 (CA3 search and graph → H1-B5), HU-05, HU-06, HU-07, HU-08, HU-23 CA1–CA2
  (CA3 → H1-B5), HU-29 CA2 (CA1 invoice-total diff → H1-B3). Shape only: HU-27 on the H1-B2 tables,
  HU-28 (archive/restore; the trash page is H1-B5), HU-20 (*Documentos* tab), HU-10 CA4 and HU-19 CA2
  (the alert rules exist; they fire on H1-B3/H1-B4 data). Full closure in H2-B3 (`coverage-matrix.md`
  §5).
- **Open decisions:** none blocking (`decisions.md` §6, blocking summary). R13 (`permissions.ts`
  bundled into client components) waits for the next rules revision; it does not affect this batch.
- **Carry-overs placed in this batch:** R16 → 2.7. DT-71 → every package with an action. DT-72 → 1.2
  (contract comment) and 2.6 (`nameEn` field, English falls back to `name`). m-g (catalog list services
  take `(ctx, input)` and filter inactive rows) → 1.1. m6 (export entity list) and the `toCsv`
  money-column comment → 1.2. M5 note (`exportCsvAction` with the first module list) → 1.2 seam plus one
  export action per module. m8 (owner of the files fixture) → 1.1. m1 (breadcrumb labels for detail ids)
  → 1.3. R15 per-page titles → every page created in this batch (`generateMetadata`; the root title
  template stays in H1-FX). **Kept out (H1-FX):** N1, N2, N4, R14, the R15 title template, coverage
  gaps, the flaky jsdom timeouts.
- **Planner decisions taken in this plan** (approved by the user 2026-10-10, recorded as DT-78; none
  changes the MVP scope):
  - **PD-1 Three waves, not two.** W1 = dataset and seams; W2 = services, adapters and cross-entity
    components; W3 = screens. Reason: the slices consume the cross-entity tabs and each other's queries
    (the client's *Proyectos* tab reads projects; the project form searches clients). The intra-wave rule
    forbids that inside one wave.
  - **PD-2 Export.** One mock service `exportCsv(ctx, input, source)` and one action factory (1.2). Each
    module declares its own export action with its own `source`. There is no central registry file that
    every module would edit. The `EXPORT` activity entry stays in H2-B6 (`coverage-matrix.md` §1 row
    14).
  - **PD-3 Normalized store rows.** The H1-B2 collections store rows with ids (tags, technologies,
    clients, authors, links), not denormalized DTOs. Services assemble the DTOs, so a label never goes
    stale after a rename. This is the shape the H2-B3 Prisma services return.
  - **PD-4 Financial metrics computed on read.** Client and project USD metrics are computed by their
    mock services from the finance collections (empty until H1-B3, so `"0.00"`), never typed into
    fixtures (`data-rules.md` §2).
  - **PD-5 Bell panel.** 2.7 lists the alerts in the existing bell panel so the counter and the panel
    agree. The dashboard panels and "Marcar leídas" stay in H1-B5.
  - **PD-6 Error with a link.** `ActionError` gains an optional `entity: EntityRef`, so a `CONFLICT` can
    link the existing record (HU-03 CA3, frontend-patterns §6). Today the adapter cannot carry it.
- **Declared cross-batch edits:**
  - Client tabs *Facturas* and *Pagos* and the client financial card; project tabs *Cobro*, *Facturas*
    and *Gastos*: H1-B2 renders `FinanceTabSlot` (empty state, 1.3). H1-B3 W3 replaces the slots and
    owns `src/app/(app)/clients/[id]/**` and `src/app/(app)/projects/[id]/**` in that wave.
  - `src/mocks/fixtures/documents.ts` (1.1), `src/mocks/services/documents.ts` and
    `src/features/documents/**` (2.8) are minimal in H1-B2. H1-B4 takes ownership and extends them,
    keeping the exported names.
  - The note link picker (3.3) offers client, contact, project and document. H1-B3 adds invoice, payment
    and expense to `src/features/notes/components/note-link-picker.tsx`.
  - `src/mocks/services/{clients,projects,alerts}.ts` read the finance collections directly. H1-B3 may
    switch those reads to `src/lib/finance` (owner declared in H1-B3).
  - The "Detalle | Grafo" toggle links to `/<entity>/[id]/graph`, an in-shell 404 until H1-B5. Links to
    `/documents/[id]` and `/projects/[id]/billing` are in-shell 404s until H1-B4 and H1-B3.
- **i18n namespace ownership (DT-31).** One owner per namespace per wave; "add-only" = only new keys.
  `enums`, `validation`, `patterns` (except 1.3's add-only block), `settings`, `search`, `mock`,
  `common` are read-only in the whole batch.

  | Namespace | W1 | W2 | W3 |
  |---|---|---|---|
  | `nav` | 1.3 (add `segments.detail`) | — | — |
  | `patterns` | 1.3 (add-only block `financeSlot`) | — | — |
  | `table` | 1.2 (add-only block `export`) | — | — |
  | `clients`, `contacts` | — | 2.1 | 3.1 |
  | `projects` | — | 2.2 | 3.2 |
  | `notes` | — | 2.3 | 3.3 |
  | `forms` | — | 2.3 (add-only block `richText`) | — |
  | `activity` | — | 2.4 | — |
  | `tags` | — | 2.5 | — |
  | `catalogs` (block `technologies`; keep `validation`) | — | 2.6 | — |
  | `alerts` | — | 2.7 | — |
  | `shell` (block `alerts` only, add-only) | — | 2.7 | — |
  | `documents` (keep `validation`) | — | 2.8 | — |

- **Intra-wave rule:** packages of the same wave never import each other's new files; every package
  builds only on outputs of earlier waves. A W2 mock service never imports another W2 mock service: it
  reads the store collections (`ctx.db`) and resolves references with `src/mocks/entity-refs.ts` (1.1).
- **Every package spec carries:** commit messages without any Claude attribution (C6); gate = `pnpm
  lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build`; no persistent server or browser
  in a Developer worker; a needed file outside the package's list → stop and report.

---

### WAVE 1 — Dataset, mock seams and shared follow-ups

**Objective:** the coherent commercial dataset on normalized store rows, the mock seams every H1-B2
service needs (`logActivity`, entity references, the diff helper, the catalog split), the contract
follow-ups (error with link, safe rich-text images, export entity list), the CSV export seam, breadcrumb
labels for detail routes, the finance-tab slot and the missing registry items.

**Shared-file owners (wave 1):**

| Shared file / area | Owner |
|---|---|
| `src/mocks/store.ts`, `src/mocks/fixtures/{clients,contacts,projects,notes,activity,documents}.ts`, new `src/mocks/entity-refs.ts`, `src/mocks/services/catalogs.ts`, new `src/mocks/services/{tags,technologies,activity}.ts`, `src/features/catalogs/queries.ts`, `src/lib/validators/catalogs.ts` (list-input schemas only), new `src/lib/activity-diff.ts` | 1.1 |
| `src/lib/validators/{common,export,notes,technologies}.ts`, `src/server/errors.ts`, `src/server/actions/define-action.ts`, `src/lib/csv.ts` (comment only), new `src/mocks/services/export.ts`, new `src/features/export/**`, i18n `table` (add-only) | 1.2 |
| `src/components/app/app-breadcrumbs.tsx`, new `src/components/app/breadcrumb-label.tsx`, `src/app/(app)/layout.tsx`, new `src/lib/entity-routes.ts`, new `src/components/patterns/finance-tab-slot.tsx`, registry `src/components/ui/{alert,item,attachment}.tsx`, i18n `nav`, `patterns` (add-only) | 1.3 |
| `package.json` / lockfile, `src/mocks/{ctx,ids,session}.ts`, `src/mocks/fixtures/{catalogs,billing,invoices,payments,accounts,expenses,shares}.ts`, `src/server/context.ts`, `src/config/**`, every other `src/lib/validators/**` file | nobody |

**Cross-package rule (wave 1):** 1.2 keeps every export name of the files it edits (`common.ts`,
`errors.ts`, `define-action.ts`), so 1.1 and 1.3 compile after the merge. 1.1 keeps every export name
of `catalogs.ts` (re-exports where a function moves).

#### Package 1.1 — Commercial dataset, normalized store rows and mock seams

Package 1.1 → Agent: wedevs-developer · sonnet — Reason: changes the shared mock-store shape (`store.ts`) and adds the service seams (`logActivity`, entity references, catalog list signatures) that every H1-B2 service and the Hito 2 swap depend on (shared signatures, C9–C12).

Depends on: H1-B1 only.

Files: `src/mocks/store.ts` (+ `store.test.ts`); `src/mocks/fixtures/{clients,contacts,projects,notes,activity,documents}.ts`
(+ new `src/mocks/fixtures/commercial.test.ts`); new `src/mocks/entity-refs.ts` (+ test);
`src/mocks/services/catalogs.ts` (+ test); new `src/mocks/services/{tags,technologies,activity}.ts`
(+ tests); `src/features/catalogs/queries.ts` (+ `catalogs.test.ts`); `src/lib/validators/catalogs.ts`
(list-input schemas only, + test); new `src/lib/activity-diff.ts` (+ test). No other file.

- [x] **PD-3 Store rows.** In `store.ts`, the collections `clients`, `contacts`, `projects`, `notes`,
      `documents`, `documentVersions`, `documentLinks` and `activity` hold row types declared next to
      their fixtures. Rows are derived from the contract types (`Pick`/`Omit` of the DTOs, C8) plus
      foreign keys only: client rows without `contacts`, `financials` and embedded tags (`tagIds`);
      contact rows with `clientId` and `tagIds`; project rows with `clients: { clientId, role }[]`,
      `technologyIds`, `tagIds`, `links`, and without the financial headline and `hasBillingPlan`
      (derived); note rows with `authorId`, `tagIds`, `links: NoteLinkTarget[]`, `attachmentFileIds`,
      without `contentText`; document rows with ids instead of embedded refs; `deletedById` where the
      schema has it. Finance collections are not touched. List the final row types in `worker_done`.
- [x] **Dataset** (`// MOCK`, fictional; the wireframes' names are allowed; every row valid against its
      contract once assembled). Dates relative to the store's build `now` where they drive status or
      alerts (factories like `createCatalogFixtures`):
      - ≥ 60 clients: both kinds, several countries (VE with valid RIFs), every `ClientStatus` (≥ 3
        `PROSPECTO`), tags; one archived client; one client with active projects (archive confirmation
        path); one client with no projects or contacts. The fixture header documents one active
        tax id + country for the duplicate E2E (HU-03 CA3).
      - Contacts: clients with 0, 1 and 3 contacts; at most one primary per client; each contact has an
        email or a phone.
      - ~25 projects: every `ProjectStatus`; ≥ 5 with two or three clients and roles; Next.js in ≥ 2
        projects (HU-06 CA2); ≥ 1 active technology used by no project (HU-06 CA3 delete path); links in
        ≥ 4 groups, one project with ≥ 2 `REPOSITORIO` links (HU-07); descriptions with allowlisted
        Tiptap nodes only.
      - ~40 notes: pinned and unpinned; ≥ 1 linked to a client and a project at once (HU-23 CA2); notes
        by the default mock user and by another user (Member own-delete check); attachments.
      - ~10 documents (minimal, cross-batch with H1-B4): each `DocumentFormat`; one linked to a client
        and two projects (HU-20 shape); one expiring within 30 days and one `VENCIDO` (alerts); versions
        and files as their contracts require.
      - ~150 activity entries over the last ~60 days: actors `USER`, `SYSTEM`, `PUBLIC`; actions
        `CREATE`, `UPDATE` (with diffs), `DELETE`, `RESTORE`, `STATUS_CHANGE`, `LINK`, `UNLINK`, `UPLOAD`,
        `LOGIN`, `SYSTEM_JOB`, `PORTAL_ACCESS`; IPs only from 192.0.2.0/24 and 198.51.100.0/24 (C5); no
        sensitive field in any diff; long texts as the `"changed"` marker.
- [x] **m8 decision:** `fileFixtures` (in `fixtures/documents.ts`) belongs to the dataset in H1-B2 (note
      attachments, document files); runtime uploads are appended by `services/files.ts` (unchanged);
      H1-B4 takes ownership of `fixtures/documents.ts`. Write this in the file header.
- [x] `entity-refs.ts`: `resolveEntityRef(db, entityType, id): EntityRef | null` for every `EntityType`
      that has a collection (H1-B2 ones now; finance ones answer from their collections when filled).
      `label` = trade name / name / title or first words; `code` when the entity has one.
- [x] `services/activity.ts`: `mockTx(ctx)` → `{ db, now }` and `logActivity(tx, input)` (the contract
      signature, C8): parses with `logActivityInputSchema`, appends an `ActivityEntryDTO` (id from
      `nextMockId`, `createdAt` = `tx.now`), returns it. No update or delete function (C20).
- [x] `lib/activity-diff.ts`: pure, framework-free `diffFields(before, after, { fields, longText?,
      exclude? })` → `ActivityChanges | undefined`: values only strings, booleans or `null` (money stays
      a decimal string, C15); long texts → `"changed"`; excluded fields never appear. Reused by H2-B3.
- [x] **Catalog split.** Move `listTags` (+ new `getTag`, usage count) to `services/tags.ts` and
      `listTechnologies` (+ new `getTechnology`, usage count) to `services/technologies.ts`, adapted to
      the new rows (usage counts non-archived records only). `catalogs.ts` re-exports both under the same
      names; document-type usage adapted to the new document rows.
- [x] **m-g.** Every catalog list service takes `(ctx, input)`. New list-input schemas in
      `validators/catalogs.ts` (e.g. `includeInactive`, default `false`) for currencies, payment methods
      and expense categories; pickers get active rows only, settings screens ask for all explicitly.
      `listTechnologies` / `listDocumentTypes` keep their filter schemas (`active` facet).
      `features/catalogs/queries.ts` updated; existing callers keep working.
- [x] Tests: every fixture assembles into a DTO that parses with its contract; referential integrity
      (every id resolves; at most one primary contact per client; every note has ≥ 1 link; every active
      project has ≥ 1 non-archived client); dataset counts and required cases above; `logActivity`
      validates and appends; `diffFields` cases (money string, long text, excluded field, unchanged →
      `undefined`); catalog re-exports; m-g inactive filtering; reset rebuilds the new collections.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 1.2 — Contract follow-ups, error with link and the CSV export seam

Package 1.2 → Agent: wedevs-developer · sonnet — Reason: edits shared validators and the action adapter (`ActionError`, `ServiceError`, `toActionError`) that every module consumes, and creates the export service seam (C8, C10, C4 on rich-text images).

Depends on: H1-B1 only.

Files: `src/lib/validators/{common,export,notes,technologies}.ts` (+ tests); `src/server/errors.ts`
(+ test); `src/server/actions/define-action.ts` (+ test); `src/lib/csv.ts` (comment only); new
`src/mocks/services/export.ts` (+ test); new `src/features/export/define-csv-export-action.ts`, new
`src/features/export/use-csv-export.ts` (+ tests); `src/i18n/messages/{es,en}/table.json` (add-only
block `export`). No other file.

- [x] **PD-6.** `ActionError` gains `entity?: EntityRef`; `actionError` accepts it; `ServiceError`
      accepts `{ entity }`; `toActionError` copies it. Tests: a `CONFLICT` with an entity survives the
      adapter unchanged; nothing else leaks.
- [x] **C4, rich-text images** (`notes.ts`, consumed by notes and project descriptions): `image` nodes
      require `attrs.fileId` (`idSchema`) and allow `alt` (≤ 200); `src`, when present, must equal
      `/api/files/<fileId>/download`; any other image attribute is rejected. Tests: `javascript:`,
      `data:` and external `src` rejected; a `fileId` image accepted.
- [x] **DT-72** `technologies.ts`: replace the stale "NOTE for H2-B1" with DT-72 (Δ4 decided; English
      display falls back to `name`). Comment only.
- [x] **m6** `export.ts`: reconcile `EXPORT_ENTITY_VALUES` with every table of PRD §7.3/§8/§8.15 (at least
      add `TECHNOLOGY`; check document types, currencies, payment methods, expense categories,
      installments, recurring charges, users, trash). List the final set in `worker_done`.
- [x] **PD-2 export contract** in `export.ts`: `EXPORT_MAX_ROWS = 10_000`; `ExportCsvResultDTO =
      { filename, content, rowCount, truncated }` (Zod schema + type); a TypeScript `ExportSource` type:
      `{ entity, facets (for toModuleQuery), filterSchema, list(ctx, filter) → Paginated<Row>, columns:
      Record<columnId, { labelKey, type?: "text" | "money", value(row) }> }`.
- [x] **PD-2 mock service** `exportCsv(ctx, input, source)` (`// MOCK`, framework-free, C11): `input.entity`
      must equal `source.entity`; turns `input.query` into the module filter with `toModuleQuery` +
      `source.filterSchema`; pages `source.list` (page size 100) up to 10,000 rows (`truncated` beyond);
      keeps only `input.columns` in the requested order (unknown id → `VALIDATION`); serializes with
      `toCsv` (BOM, CRLF, formula guard; money verbatim); filename `<entity>-<YYYY-MM-DD>.csv` with the
      Caracas date of `ctx.now`. Headers arrive translated in the source (see the factory). No activity
      entry (H2-B6).
- [x] `defineCsvExportAction({ entity, permission, source, exportCsv, namespace })`: wraps `defineAction`
      (input = `exportCsvInputSchema` narrowed to `entity`); resolves each column's `labelKey` with
      `getTranslations(namespace)`; calls the injected `exportCsv` (this file never imports `@/mocks`,
      C9). `permission` must be a real `can()` grant (DT-71).
- [x] `useCsvExport(action)`: client hook returning the kit's `onExport(query, visibleColumns)`: calls
      the action, downloads a `text/csv;charset=utf-8` Blob, toasts success, the "truncated at 10,000
      rows" warning, or `common.errors.<code>`. Strings in `table.export.*` (ES and EN).
- [x] `csv.ts` nit: comment that money columns are decimal strings written verbatim, never
      locale-formatted.
- [x] Tests: export seam with a fake source (filters applied, more than one page, cap with `truncated`,
      column order, unknown column → `VALIDATION`, BOM, money verbatim, formula guard, filename date in
      Caracas); factory (headers translated; Member on `{ read, activity }` → `FORBIDDEN`); hook (Blob
      download and toasts with mocked action).
- [x] Gate. Commit messages without any Claude attribution.

#### Package 1.3 — Breadcrumb labels, entity routes, finance-tab slot and registry items

Package 1.3 → Agent: wedevs-developer · haiku — Reason: shell UI over the existing breadcrumbs, a small presentational pattern, a pure route map and registry installs; no data, money or auth logic.

Use the shadcn MCP.

Depends on: H1-B1 only.

Files: `src/components/app/app-breadcrumbs.tsx` (+ test); new `src/components/app/breadcrumb-label.tsx`
(+ test); `src/app/(app)/layout.tsx`; new `src/lib/entity-routes.ts` (+ test); new
`src/components/patterns/finance-tab-slot.tsx` (+ test); registry `src/components/ui/alert.tsx`,
`src/components/ui/item.tsx` (and `src/components/ui/attachment.tsx` only if added);
`src/i18n/messages/{es,en}/nav.json`; `src/i18n/messages/{es,en}/patterns.json` (add-only block
`financeSlot`). No other file.

- [x] **m1.** `BreadcrumbLabelProvider` (client) wraps the shell content in `(app)/layout.tsx`;
      `<BreadcrumbLabel segment label />` lets a detail page name its id segment (e.g. "CLI-0007 ·
      Kairos Studio"). Until a label is registered, an id segment shows `nav.segments.detail`
      ("Detalle" / "Detail"), the same markup on the server and the first client render (no hydration
      mismatch; cf. 5.4 D2). Unregisters on unmount. Tests.
- [x] `lib/entity-routes.ts`: pure `entityHref({ type, id })` for every `EntityType` with its own route in
      PRD §11; `null` for types without one (e.g. `CONTACT`, `FILE`, `TAG`, `SETTING`). Test every type.
- [x] `FinanceTabSlot`: `EmptyState` for finance tabs not built yet (title and description per tab kind
      from `patterns.financeSlot.*`), so H1-B3 replaces one component.
- [x] Registry: `pnpm exec shadcn add alert item`; `attachment` only if the MCP shows it fits note and
      document attachment chips (report the choice). Verify that `package.json` and `pnpm-lock.yaml` are
      unchanged; if not, revert and report. Report any registry file edit (C3).
      - *Choice (1.3):* `alert` and `item` added (`pnpm dlx shadcn@4.21.4 add`); `attachment` not added: the shadcn MCP gives no usage or example that shows a note/document chip fit, so no attachment component is in this package (the note and document chips are left to their H1-B2 owners). No lockfile or package.json change.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 1.4 — Code review fixes r2 and r3 (added 2026-10-10, user-approved)

Package 1.4 → Agent: wedevs-developer · haiku — Reason: two small, local fixes found by the wave 1 Code
Reviewer; no shared signature changes.

Depends on: 1.1, 1.2 (merged).

Files: `src/features/export/use-csv-export.ts` (+ `use-csv-export.test.tsx`); `src/mocks/fixtures/documents.ts`
(type declaration of `DocumentLinkRow` only). No other file.

- [x] **r2.** `downloadCsv` revokes the object URL on a later tick (`setTimeout(() =>
      URL.revokeObjectURL(url), 0)`), not right after `link.click()` (Firefox can cancel the download).
      Test with fake timers: not revoked synchronously, revoked after the tick.
- [x] **r3 (C8).** `DocumentLinkRow` derives from the contract: `Pick<DocumentLinkDTO, "id" | "createdAt">`
      plus the foreign keys `documentId`, `entityType`, `entityId` (keep the export name and the field set;
      no fixture data change). If the contract field names differ, keep the derivation and report.
- [x] Gate. Commit messages without any Claude attribution.

#### Wave 1 close

- [x] **Integration checklist:** 1.1, 1.2, 1.3 merged into `batch/h1-b2-commercial-core`; no Claude
      attribution; worktrees removed; lockfile unchanged (`git diff 6acc4d8 -- pnpm-lock.yaml` empty);
      lint, typecheck, test, `i18n:check`, build pass. *(2026-10-10: merges ae6df41, 6015035 and 1.1;
      128 files, 1930 tests + 1 expected fail; lockfile diff empty. Deviations: 1.1 test-only fixes in
      `files.test.ts`, `features/files/{actions,upload-adapter}.test.ts` approved by the Orchestrator; 1.2
      `useCsvExport(action, entity)`; 1.3 `attachment` not installed — 2.3/2.8 decide.)*
- [x] **Planner coherence review** (`READY FOR CODE REVIEW` or blockers): row types derive from the
      contracts (no invented field besides foreign keys); fixtures assemble into valid DTOs; every
      catalog export name still resolves; `logActivity` matches the `ActivityService` contract signature;
      `ExportSource` fits `toModuleQuery` and each H1-B2 filter schema; `ActionError.entity` reaches the
      client; the image rule does not reject the 1.1 project descriptions; `entityHref` routes = PRD §11;
      i18n blocks in both languages. *(2026-10-10, Planner: READY FOR CODE REVIEW. No blockers. Minor: m1
      rich-text helpers duplicated in `mocks/entity-refs.ts` → canonical in 2.3 `lib/rich-text.ts`; m2 no
      `satisfies` contract check on activity/tags/technologies mock services → 2.4/2.5/2.6; m3
      `listDocumentCategories(ctx)` keeps no input (accepted). Nits n1–n5 folded into the wave 2 specs.
      Attachment decision recorded in "Wave 1 facts".)*
- [x] **Code review** (`wedevs-code-reviewer`, integrated branch): C1, C3 (registry installs, no
      hand-written equivalents), C4 (image attributes), C5 (fixture data, IP ranges, `// MOCK`
      headers), C6, C7, C8, C9 (export factory imports no mocks), C10 (error mapping), C11, C15, C20 (no
      update/delete in the activity service), C25. *(2026-10-10, Code Reviewer: READY FOR TESTING. No
      blockers. `shadcn@4.21.4 add alert item --dry-run --diff` = no changes. Minor: r1 the C4 image rule
      rejects Tiptap's `null` attr defaults (`alt`/`title`) → 2.3 must emit only `fileId`/`alt`/`src` and
      drop nulls, or the schema accepts `alt: null`; r2 `useCsvExport` revokes the Blob URL synchronously
      after `click()` → defer it; r3 `DocumentLinkRow` hand-declares `id`/`createdAt` instead of
      `Pick<DocumentLinkDTO, …>` (C8). Nits: `/reports/[report]` slugs now crumb as "Detalle"; `diffFields`
      compares arrays as ordered JSON.)*
- [x] **User confirms the Tester may run.** *(2026-10-10: "procede con los test".)*
- [x] **Tester scope:** `vitest run --coverage` (report `mocks/`, `lib/activity-diff.ts`,
      `mocks/services/export.ts`, `features/export/**`), `i18n:check`, build, lint, typecheck. No E2E (no
      new route). No server, no container. *(2026-10-10, Tester (Orca worker, haiku), HEAD 1592a3b, no
      commits: PASS. 128 files; 1931 pass + 1 expected fail with `--testTimeout=20000`; default runs hit
      1–2 known jsdom timeouts (phone-input, country-combobox), which pass alone (27 + 1 expected fail).
      money.ts 100/100, rates.ts 97.43/96.42. Targets: `lib/activity-diff.ts` 100, `mocks/services/export.ts`
      96.29 stmts, `features/export/**` 100; `entity-routes`, `finance-tab-slot`, `breadcrumb-label` 100.
      Informational below 90: `mocks/entity-refs.ts` 83.56, `mocks/store.ts` 89.65, `mocks/test-helpers.ts`
      77.77, `mocks/services/technologies.ts` 89.47. Dataset: exact counts 65/96/26/41/11/13/161 (+17
      document links), the 3 fixture ids exist, zero FK violations. i18n parity (32 namespaces), build,
      lint, typecheck PASS.)*
- [x] **Problem report** (Developers, Planner, Code Reviewer, Tester — "none" stated explicitly).
      *(Developers: 1.1 test-only fixes for the populated files store (approved); 1.3 did not install
      `attachment` (decided by the Planner, owned by 2.3). Planner: none blocking; m1 → 2.3, m2 → 2.4/2.5/2.6,
      m3 accepted. Code Reviewer: r1 → 2.3 spec; r2, r3 fixed in 1.4; nits (`/reports/[report]` crumbs as
      "Detalle" → H1-B5; `diffFields` ordered arrays → callers sort ids). Tester: known jsdom timeouts in
      phone-input/country-combobox (→ H1-FX); coverage report needs `reportOnFailure` when a flake fails;
      `mocks/entity-refs.ts` funcs 61.53 (→ 2.3 moves rich-text helpers to `lib/rich-text`).)*
- [x] **Summary** written by the Orchestrator. *(Wave 1 delivered the commercial dataset and normalized
      store rows, the mock seams (entity refs, activity/tags/technologies services, `diffFields`), the
      CSV export seam and per-module export convention, `ActionError.entity`, strict image attributes,
      breadcrumb labels, `entityHref`, the finance-tab slot and the `alert`/`item` registry items. Four
      packages (1.1–1.4), merged into `batch/h1-b2-commercial-core` at 1592a3b; gate green.)*

🛑 **MANDATORY STOP** — wave 2 does not start without the user's explicit approval.

---

### WAVE 2 — Services, adapters and cross-entity components

**Objective:** every H1-B2 mock service with its queries and actions (PRD §12 names, `fn(ctx, input)`,
`defineAction`), and the cross-entity UI the detail screens of W3 compose: the rich-text kit and the
*Notas* tab, the activity timeline with `/activity` and the *Actividad* tab, the tag picker with
`/settings/tags`, the technology picker with `/settings/technologies`, `AlertList` with the live bell,
and the *Documentos* tab with its attach sheet.

**Shared-file owners (wave 2):**

| Shared file / area | Owner |
|---|---|
| `src/mocks/services/{clients,contacts}.ts`, `src/features/clients/{queries,actions,columns}.ts`, `src/features/contacts/{queries,actions}.ts`, i18n `clients`, `contacts` | 2.1 |
| `src/mocks/services/projects.ts`, `src/features/projects/{queries,actions,columns}.ts`, i18n `projects` | 2.2 |
| new `src/lib/rich-text.ts`, new `src/components/ui/rich-text/**`, `src/mocks/services/notes.ts`, `src/features/notes/**`, i18n `notes`, `forms` (add-only block `richText`) | 2.3 |
| `src/mocks/services/activity.ts` (adds `listActivity`; `logActivity`, `mockTx`, `MockTx`, `toActivityEntryDTO` unchanged), `src/features/activity/**`, `src/app/(app)/activity/**`, i18n `activity` | 2.4 |
| `src/mocks/services/tags.ts` (keeps `listTags`, `getTag`, `tagUsage`), `src/features/tags/**`, `src/app/(app)/settings/tags/**`, i18n `tags` | 2.5 |
| `src/mocks/services/technologies.ts` (keeps `listTechnologies`, `getTechnology`, `technologyUsage`), `src/features/technologies/**`, `src/app/(app)/settings/technologies/**`, i18n `catalogs` (block `technologies`) | 2.6 |
| `src/mocks/services/alerts.ts`, `src/features/alerts/**`, `src/features/shell/queries.ts`, `src/components/app/alerts-bell.tsx`, i18n `alerts`, `shell` (block `alerts`, add-only) | 2.7 |
| `src/mocks/services/documents.ts`, `src/features/documents/**`, i18n `documents` (keep `validation`) | 2.8 |
| `src/mocks/store.ts`, `src/mocks/fixtures/**`, `src/mocks/entity-refs.ts`, `src/mocks/services/{catalogs,export,files}.ts`, `src/features/{catalogs,export,files}/**`, `src/lib/validators/**`, `src/server/**`, `src/components/app/**` (except `alerts-bell.tsx`), `src/components/{ui,patterns}/**` (except `ui/rich-text/**`), `src/app/(app)/layout.tsx`, `src/config/**`, `package.json` / lockfile | nobody (read-only) |

**Cross-package rule (wave 2):** a package that needs a fixture case, a contract field or a shared-file
change does not edit it: it stops and reports (fix package after the wave). Mock services read other
modules' rows through `ctx.db` and `entity-refs.ts`, never through another W2 service.

**Wave 1 facts every W2 package builds on (Planner coherence review, 2026-10-10):**

- Rows (re-exported by `src/mocks/store.ts`): `ClientRow` (`tagIds`, `deletedById`), `ContactRow` (`tagIds`; no
  `deletedById`, PRD §10 `Contact`), `ProjectRow` + `ProjectClientRow { clientId, role }` (`technologyIds`,
  `tagIds`, `deletedById`), `NoteRow` (`authorId`, `tagIds`, `links: NoteLinkTarget[]`, `attachmentFileIds`,
  `deletedById`; no `contentText`), `DocumentRow` (`typeId`, `currentVersionId`, `tagIds`, `createdById`,
  `deletedById`), `DocumentVersionRow` (`fileId`, `createdById`), `DocumentLinkRow`, `ActivityRow` (`actorType`,
  `actorId`), `AlertDismissalRow` (DTO + `userId`), `TagRow`, `TechnologyRow` (carries `nameEn`). Factories
  `create*Fixtures(now)`; `fileFixtures` lives in `fixtures/documents.ts` (m8).
- Seams: `resolveEntityRef(db, type, id)`, `richTextToPlainText`, `firstWords` (`src/mocks/entity-refs.ts`);
  `mockTx(ctx) → MockTx`, `logActivity(tx, input)`, `toActivityEntryDTO(db, row)` (`src/mocks/services/activity.ts`);
  `diffFields(before, after, { fields, longText?, exclude? })` (`src/lib/activity-diff.ts`); `tagUsage`, `getTag`
  (`services/tags.ts`); `technologyUsage`, `getTechnology` (`services/technologies.ts`); `catalogs.ts` re-exports
  the reads; `listDocumentCategories(ctx)` takes no input.
- Errors: `ServiceError(code, { message?, fieldErrors?, entity? })` (from `src/mocks/ctx`); `entity` reaches
  `ActionError.entity`.
- Export: `defineCsvExportAction({ entity, permission, source, exportCsv, namespace })`; `source:
  ExportSource<Row, Filter, ServiceContext> = { entity, facets, filterSchema, list, columns }`; the module's
  `actions.ts` injects `exportCsv` from `@/mocks/services/export`. Convention: `namespace: "<module>"`, each
  `labelKey` = `columns.<id>` (the same keys `columns.ts` gives the W3 table). `source.columns` holds every column
  id the W3 table can export (the kit sends the visible columns except `meta.exportable === false`; an unknown
  id → `VALIDATION`); `facets` use the W3 table's facet ids; a `dateRange` facet declares `fromKey`/`toKey` when
  the filter keys are not `<id>From`/`<id>To`. Client: `useCsvExport(action, entity)` — `entity` is the 2nd arg.
- Routes: `entityHref({ type, id })` is `null` for `CONTACT`, `FILE`, `TAG`, `USER`, `SETTING`, `TRANSFER`,
  `ACCOUNT_MOVEMENT`, `BILLING_PLAN`, `INSTALLMENT`, `RECURRING_CHARGE`: render the label or chip without a link.
- Registry: `alert` and `item` are installed; `attachment` is **not**. **Attachment decision (Planner):** W2 does
  not install it (`src/components/ui/**` is read-only in W2). Note and document attachment chips are compositions
  of installed registry items (`item`, `badge`, `button`, `tooltip`), DU-02, after consulting the shadcn MCP
  (2026-10-10: `@shadcn/attachment` exists, deps `cn` + `radix-ui`, no demo or usage example). **Decision owner:
  2.3** (chips in `NoteCard` / `NoteComposer`), reported in `worker_done`; 2.8 follows the same composition in
  its own file (no cross-import). If either finds `attachment` necessary, it stops and reports; the install
  becomes a single-owner fix package after W2.

#### Package 2.1 — Clients and contacts: mock services and adapters

Package 2.1 → Agent: wedevs-developer · sonnet — Reason: carries the rules of the critical story HU-03 (code sequence, `CONFLICT` with a link, archive cascade lock C19, restore conflict) and USD aggregates (C15/C16); the service shape is what H2-B3 reproduces.

Depends on: 1.1 (rows, `logActivity`, `diffFields`, `entity-refs`), 1.2 (`ActionError.entity`, export
factory).

Files: `src/mocks/services/{clients,contacts}.ts` (+ tests); `src/features/clients/{queries,actions,columns}.ts`
(+ tests); `src/features/contacts/{queries,actions}.ts` (+ tests); `src/i18n/messages/{es,en}/{clients,contacts}.json`.
No UI file.

- [x] Mock services with the exact names and signatures of `ClientsService` and `ContactsService` (C9):
      - `createClient`: code from the `CLI` mock sequence (`CLI-####`, HU-03 CA2); status default
        `PROSPECTO`; `CONFLICT` when a non-archived client has the same normalized tax id + country →
        `ServiceError("CONFLICT", { message: "clients.errors.duplicateTaxId", entity: <existing ref> })`
        (HU-03 CA3); `CREATE` activity (HU-03 CA4).
      - `updateClient` (same `CONFLICT`; `UPDATE` with `diffFields`), `setClientStatus`
        (`STATUS_CHANGE`; `activatedAt` the first time it becomes `ACTIVO`).
      - `archiveClient` / `archiveClients`: with active projects or open invoices and `confirm: false` →
        `INTEGRITY_LOCK` (`clients.errors.archiveNeedsConfirm`); with `confirm: true` archives the client
        and its contacts (count in the result), `DELETE` entries (C19).
      - `restoreClient`: `CONFLICT` (with entity) when an active client now holds the same tax id +
        country; restores the contacts archived by the same cascade (contacts carry no `deletedById` or cascade
        marker, PRD §10 `Contact`: the cascade set = the client's contacts whose `archivedAt` equals the
        client's `archivedAt`); `RESTORE`.
      - `listClients` (every `clientFilterSchema` filter; `includeArchived` honoured only when
        `can(ctx.user, "restore", "trash")`), `getClient` (contacts primary first), `getClientFinancials`,
        `getClientsOverview`. PD-4: USD metrics from the finance collections with `sumMoney` over stored
        snapshots (C15, C16); `projectCount` from non-archived project rows; `lastActivityAt` from the
        activity rows.
      - Contacts: `createContact`, `updateContact`, `setPrimaryContact` (unsets the previous primary,
        HU-04 CA2), `archiveContact`, `listContacts` (by client); activity on `CONTACT`.
- [x] Adapters (`defineAction`, real grants, DT-71): create/update/status `{ create | update, client }`;
      archive `{ delete, client }`; restore `{ restore, trash }`; contacts `{ … , contact }`; read actions
      `searchClientsAction` (`{ read, client }`, `q`, ≤ 20 `EntityRef` options) and
      `searchContactsAction` (`{ read, contact }`); `exportClientsCsvAction` through the 1.2 factory
      (`{ read, client }`, `namespace: "clients"`, source = `listClients` + `clientFilterSchema` +
      `clients/columns.ts`); no `CONTACT` export (`contactFilterSchema` requires `clientId`). Mutations log
      through `mockTx(ctx)` + `logActivity`; `UPDATE` diffs with `diffFields`. Revalidate `/clients` paths.
- [x] `queries.ts`: `listClients`, `getClient` (`NOT_FOUND` lets the page call `notFound()`),
      `getClientsOverview`, `getClientFinancials`, `listContacts`.
- [x] `clients/columns.ts`: table column ids of PRD §8.2 "Tabla", label keys `clients.columns.*`,
      money flag; shared by the export source and the W3 table.
- [x] i18n `clients`, `contacts` (ES and EN): error keys, column labels, toast keys the actions return.
- [x] Tests: every rule above (sequence, `CONFLICT` with entity on create/update/restore, cascade with and
      without `confirm`, primary uniqueness, `includeArchived` ignored for Member, metrics `"0.00"` with
      empty finance collections and summed with seeded test rows, activity entries and diffs); adapters:
      Member and Viewer on create → `FORBIDDEN`, bad input → `VALIDATION`, `CONFLICT` keeps `entity`.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.2 — Projects: mock services and adapters

Package 2.2 → Agent: wedevs-developer · sonnet — Reason: the status state machine with required dates and hints, the N:M client links and link ordering are the contract H2-B3 reproduces, with activity side effects (C12 shape); borderline, so sonnet.

Depends on: 1.1, 1.2.

Files: `src/mocks/services/projects.ts` (+ test); `src/features/projects/{queries,actions,columns}.ts`
(+ tests); `src/i18n/messages/{es,en}/projects.json`. No UI file.

- [x] `ProjectsService` names (C9) except `getProjectFinancials` (H1-B3; not exported in H1-B2):
      - `createProject`: ≥ 1 client (HU-05 CA1), `PRY-####`, `PROPUESTA` by default; stack only active
        technology ids (unknown or inactive → `VALIDATION` on the field, HU-06 CA1); links; `CREATE` and
        `LINK` entries.
      - `updateProject`, `setProjectClients` (roles, HU-05 CA2; `LINK`/`UNLINK`),
        `setProjectTechnologies`, `upsertProjectLinks` (URL rule from the contract, HU-07 CA3),
        `reorderProjectLinks` (order within a group persists, HU-07 CA2), `removeProjectLink`.
      - `setProjectStatus`: only transitions allowed by `PROJECT_STATUS_TRANSITIONS`; dates required by
        the contract (HU-08 CA1–CA2); hints per PRD §8.3 (`EN_CURSO` without a billing plan; `MANTENIMIENTO`
        without an active recurring charge); `CANCELADO` applies the chosen options to the installment and
        recurring collections (empty until H1-B3); `STATUS_CHANGE` with `[before, after]` (HU-08 CA4).
      - `archiveProject` / `archiveProjects` (`DELETE`), `listProjects` (every `projectFilterSchema`
        filter incl. `technologyId`, HU-06 CA2), `getProject`, `getProjectsOverview`. PD-4 financial
        headline from the finance collections (`"0.00"` now).
- [x] Adapters: `{ create, project }`, `{ update, project }` (Member RU), `{ delete, project }`;
      `searchProjectsAction` (`{ read, project }`); `exportProjectsCsvAction` (`{ read, project }`,
      `namespace: "projects"`, source = `listProjects` + `projectFilterSchema` + `projects/columns.ts`;
      `technologyId` is a facet).
- [x] `projects/columns.ts`: column ids of PRD §8.3 "Tabla", label keys, money flags.
- [x] i18n `projects` (ES and EN): errors, hints, column labels, toast keys.
- [x] Tests: allowed and refused transitions, required dates, hints, cancel options, reorder per group,
      inactive technology refused, technology filter, client links with roles, activity entries; adapters:
      Member update allowed, Member create/archive `FORBIDDEN`, Viewer update `FORBIDDEN`.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.3 — Rich-text kit, notes service and the *Notas* tab

Package 2.3 → Agent: wedevs-developer · sonnet — Reason: C4 (rich-text editing and rendering must never let scripts, iframes, `on*` handlers or `javascript:`/`data:` URLs reach the DOM) and the own-records delete grant for Members (`ownerOf`, C13 shape).

Use the shadcn MCP.

Depends on: 1.1, 1.2 (image rule, export factory), 1.3 (`entityHref`, registry `item`).

Files: new `src/lib/rich-text.ts` (+ test); new `src/components/ui/rich-text/**` (editor, toolbar,
viewer, extension allowlist, + tests); `src/mocks/services/notes.ts` (+ test);
`src/features/notes/{queries,actions,columns}.ts` (+ tests); new
`src/features/notes/components/{notes-feed,note-card,note-composer,note-attachments,entity-notes-tab}.tsx`
(+ tests); `src/i18n/messages/{es,en}/notes.json`; `src/i18n/messages/{es,en}/forms.json` (add-only
block `richText`). No other file.

- [x] `lib/rich-text.ts` (pure): `richTextToPlainText(doc)`, `richTextExcerpt(doc, max)`,
      `noteDisplayTitle(title, doc)` (first words when there is no title, PRD §8.10). Canonical copies (lib
      never imports `@/mocks`): `richTextToPlainText` keeps the semantics of the mock copy in
      `src/mocks/entity-refs.ts` (text nodes, blocks joined by one space) and `noteDisplayTitle` uses the
      same six first words as `resolveEntityRef`, so a note's card title and its `EntityRef` label agree.
      The mock copy stays mock-only (deleted with `src/mocks/` in Hito 2).
      **r1 (Code Reviewer, W1):** the image rule is a strict object (`fileId`, `alt?`, `src?`); Tiptap's
      `getJSON()` emits `null` for unset attributes. The custom Image extension declares only
      `fileId`/`alt`/`src` and strips null attributes before saving; add a round-trip test editor JSON →
      `richTextDocSchema`. Changing the validator is out of scope (stop and report if unavoidable).
- [x] `RichTextEditor`: Tiptap with exactly the extensions that produce `RICH_TEXT_NODE_TYPES` and
      `RICH_TEXT_MARK_TYPES` (StarterKit configured, task list, table, link limited to `http`, `https`,
      `mailto`, image limited to `fileId`/`alt`, placeholder); `immediatelyRender: false` (no hydration
      mismatch); toolbar composed of registry `toggle`/`toggle-group`/`button-group`/`separator`/
      `tooltip` with i18n labels; pasted HTML normalized by the schema; pasted or dropped images upload
      through the existing `UploadAdapter` (`features/files/upload-adapter.ts`) and insert an `image`
      node with `fileId`; the value is checked with `richTextDocSchema` before submit. Reused by the
      project description in W3.
- [x] `RichTextView`: read-only Tiptap renderer with the same allowlist; images render as an attachment
      placeholder (file name; no URL in Hito 1); links get `rel="noopener noreferrer nofollow"` and
      open in a new tab. No `dangerouslySetInnerHTML` (C4).
- [x] Mock `NotesService`: `createNote` (author = `ctx.user`; every link target resolved with
      `resolveEntityRef`, unknown → `NOT_FOUND`; attachments must be `READY` files; `CREATE` + `LINK`),
      `updateNote` (author immutable; content diff recorded as `"changed"`), `pinNote`, `linkNote`,
      `unlinkNote` (the last link is refused), `attachFile` (`UPLOAD`), `archiveNote` (`DELETE`),
      `listNotes` (entity feed: pinned first, then newest; table filters), `getNote`; `contentText` and
      `excerpt` derived with `lib/rich-text`. Rows are `NoteRow` (`authorId`, `links`,
      `attachmentFileIds`) assembled into DTOs; activity through `mockTx` + `logActivity`; the `updateNote`
      diff through `diffFields(…, { longText: ["content"] })`; `exportNotesCsvAction` with
      `namespace: "notes"`.
- [x] Adapters: create/update/pin/link/unlink/attach `{ create | update, note }`; archive
      `{ delete, note }` with `ownerOf` = the author (Member deletes only own notes, PRD §4.3);
      `listNotesAction` (`{ read, note }`, "Cargar más"); `exportNotesCsvAction` (`{ read, note }`).
- [x] Components: `NotesFeed` and `NoteCard` (avatar, author · date with `DateText`, pin, title,
      expandable preview through `RichTextView`, tag chips, attachment chips (composition of installed `item`/`badge`/`button`; 2.3
      owns the attachment decision, see "Wave 1 facts"), actions filtered by
      `can()`); `NoteComposer` in a `sheet` (title, editor, attachments through the `Uploader`, pinned,
      links prefilled; **no tag picker in W2** — 3.3 adds it); `EntityNotesTab({ entity })` ("+ Nueva
      nota" pre-linked, feed, empty state). Viewer sees no write action.
- [x] Tests: C4 — pasting `<script>`, `<iframe>`, `<img onerror>`, a `javascript:` link and a `data:` image
      leaves none of them in the editor or viewer DOM, and the schema rejects the raw JSON; feed order;
      Member archive own vs other's note through the adapter; title and excerpt derivation; ES and EN.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.4 — Activity: `listActivity`, timeline, `/activity` and the *Actividad* tab

Package 2.4 → Agent: wedevs-developer · haiku — Reason: read-only list, timeline and diff UI over the existing contract and the 1.1 `logActivity` seam; no mutation.

Use the shadcn MCP.

Depends on: 1.1, 1.2 (export factory), 1.3 (`entityHref`, `item`).

Files: `src/mocks/services/activity.ts` (adds `listActivity`; + test); `src/features/activity/{queries,actions,columns}.ts`
(+ tests); new `src/features/activity/components/{activity-feed,activity-item,activity-diff,activity-detail-sheet,activity-stats,activity-filters,entity-activity-tab}.tsx`
(+ tests); new `src/app/(app)/activity/page.tsx` (+ `loading.tsx` if needed);
`src/i18n/messages/{es,en}/activity.json`. No other file.

- [x] `listActivity` per `activityFilterSchema` (rows assembled with `toActivityEntryDTO`; type test
      `satisfies Pick<ActivityService<MockServiceContext, MockTx>, "logActivity" | "listActivity">`) (actor, actor type, action, entity type, entity pair,
      Caracas date range; newest first). No update or delete function anywhere (C20).
- [x] `/activity` per wireframe 4.7 and frontend-patterns §13: stat cards; filters (user, action, entity
      type, dates) in the URL through `nuqs`; list grouped by day (time, actor avatar or "Sistema" /
      "Portal público", action badge, `EntityCodeChip` linked with `entityHref`, summary); detail `sheet`
      with field diffs (before struck through → after; enum fields labelled from `enums`; the `"changed"`
      marker as text), technical context (action, masked IP such as `192.0.2.•••`, browser from the user
      agent, event id), link to the entity and the immutability note (`Lock`); "Cargar más" through
      `listActivityAction` (`{ read, activity }`); "Exportar CSV" through `exportActivityCsvAction`
      (`ACTIVITY`, `{ read, activity }`, `namespace: "activity"`; the date facet is
      `{ kind: "dateRange", fromKey: "from", toKey: "to" }`, matching `activityFilterSchema`);
      `EntityCodeChip` without a link when `entityHref` is `null`. `generateMetadata` title (R15).
- [x] Access: the page checks `can(user, "read", "activity")` on the server and calls `notFound()`
      otherwise (Member, Viewer).
- [x] `EntityActivityTab({ entity })`: the same feed for one record with a readable diff ("Estado:
      Emitida → Pagada"). Detail pages render it only when `can(read, activity)`.
- [x] No edit or delete control on any activity entry (HU-29 CA2).
- [x] Tests: filters, day grouping in Caracas, diff rendering (enum, money string, `"changed"`), IP
      masking, page `notFound()` for Member, load more, ES and EN.
- [x] Gate. Commit messages without any Claude attribution. *(Ticked by the Orchestrator at integration: the worker left it open because of the known jsdom flakes; integrated gate green.)*

#### Package 2.5 — Tags: service, picker and `/settings/tags`

Package 2.5 → Agent: wedevs-developer · haiku — Reason: configurable catalog CRUD and a picker over the existing kit (`AsyncCombobox` multi with inline create).

Use the shadcn MCP.

Depends on: 1.1 (`services/tags.ts` reads, rows), 1.2 (export factory).

Files: `src/mocks/services/tags.ts` (adds `createTag`, `updateTag`, `assignTags`, `unassignTag`; + test);
`src/features/tags/{queries,actions,columns}.ts` (+ tests); new
`src/features/tags/components/{tag-picker,tag-chips,tag-form-dialog,tags-table,color-swatches}.tsx`
(+ tests); new `src/app/(app)/settings/tags/page.tsx`; `src/i18n/messages/{es,en}/tags.json`. No other
file.

- [x] Service (keeps `listTags`, `getTag`, `tagUsage`, re-exported by `catalogs.ts`; type test
      `satisfies TagsService<MockServiceContext>`; assignments write the rows' `tagIds`; finance types
      answer `NOT_FOUND` until H1-B3): `createTag` (case-insensitive unique name → `CONFLICT` with entity), `updateTag`,
      `assignTags` / `unassignTag` for every taggable type whose collection has rows (unknown or archived
      entity → `NOT_FOUND`; `LINK`/`UNLINK` entries). The service also checks
      `can(ctx.user, "update", <resource of the entity type>)` (a Member may tag projects and notes, not
      clients) and throws `FORBIDDEN`.
- [x] Adapters: `createTagAction` any-of `[{ create, settings }, { update, client }, { update, project },
      { create, note }, { create, document }]` (inline creation where the user can edit the record);
      `updateTagAction` `{ update, settings }`; `assignTagsAction` / `unassignTagAction` any-of the
      taggable updates plus the service check; `listTagsAction` `"authenticated"` (reference read,
      DT-71); `exportTagsCsvAction` (`TAG`, `{ read, settings }`).
- [x] `/settings/tags` (Owner/Admin; the page calls `notFound()` otherwise): table (chip with colour,
      usage count, created), create/edit dialog with name and colour (preset swatches through
      `toggle-group` plus a hex input), readable chip text on any colour (pure luminance helper). No
      delete (not in PRD §12). `generateMetadata` title.
- [x] `TagPicker` (multi, inline "Crear «…»" only when the user may create, colour chips) and `TagChips`.
- [x] Tests: unique name, assign/unassign rules and permission check, picker inline create, chip
      contrast helper, page access per role, ES and EN.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.6 — Technologies: service, picker and `/settings/technologies`

Package 2.6 → Agent: wedevs-developer · haiku — Reason: configurable catalog CRUD and pickers over the existing kit; the only rule (in-use lock) is a count over project rows.

Use the shadcn MCP.

Depends on: 1.1 (`services/technologies.ts` reads), 1.2 (export factory, DT-72 comment).

Files: `src/mocks/services/technologies.ts` (adds create, update, set active, delete; + test);
`src/features/technologies/{queries,actions,columns,label}.ts` (+ tests); new
`src/features/technologies/components/{technologies-table,technology-form-dialog,technology-picker,tech-stack-icons}.tsx`
(+ tests); new `src/app/(app)/settings/technologies/page.tsx`; `src/i18n/messages/{es,en}/catalogs.json`
(block `technologies`; keep `validation`). No other file.

- [x] Service (`TechnologiesService`; keeps `listTechnologies`, `getTechnology`, `technologyUsage`,
      re-exported by `catalogs.ts`; `deleteTechnology` uses `technologyUsage`; `TechnologyRow` already
      carries `nameEn` (no store change); type test `satisfies TechnologiesService<MockServiceContext>`): `createTechnology` (unique name and slug → `CONFLICT`; slug
      derived when omitted), `updateTechnology`, `setTechnologyActive`, `deleteTechnology` (in use by a
      non-archived project → `INTEGRITY_LOCK` `catalogs.technologies.errors.inUse`, HU-06 CA3; otherwise
      removed — catalog rows are not soft-deleted, `data-rules.md` §6); `SETTINGS_CHANGE` entries on
      `SETTING`.
- [x] Adapters `{ create | update | delete, settings }`; `listTechnologiesAction` `"authenticated"`
      (reference read, DT-71); `exportTechnologiesCsvAction` (`TECHNOLOGY`, `{ read, settings }`).
- [x] **DT-72:** `technologyLabel(tech, locale)` in `label.ts` = `nameEn ?? name` in English, `name` in
      Spanish; used by the table, the picker and the icons.
- [x] `/settings/technologies` (Owner/Admin; `notFound()` otherwise): table (icon, name, `nameEn`,
      category, usage count, active switch), facets category and active, create/edit dialog (name,
      optional `nameEn`, slug preview, category with `enums` labels, Simple Icons slug with live preview,
      colour), deactivate/activate, delete through `ConfirmDialog`; an in-use delete shows the lock and
      offers deactivation. `generateMetadata` title.
- [x] `TechnologyPicker`: multi-select grouped by category, active technologies only, no free values
      (HU-06 CA1). `TechStackIcons`: icons with tooltip names. **Simple Icons are resolved on the server
      only** (RSC): never import `simple-icons` into a client component (bundle size); client pickers
      show the colour dot.
- [x] Tests: lock and deactivate (HU-06 CA3), unique name/slug, picker shows only active and groups by
      category, English fallback, page access per role.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.7 — Alerts: rules, `AlertList`, live bell (R16)

Package 2.7 → Agent: wedevs-developer · sonnet — Reason: nine live rules with money comparisons (`compareMoney`, C15) and Caracas business dates that H2-B6 must reproduce, plus per-user dismiss/snooze state and a shell file; borderline, so sonnet.

Use the shadcn MCP.

Depends on: 1.1 (rows, `alertDismissals` of `AlertDismissalRow` = DTO + `userId`, `resolveEntityRef`
for labels), 1.3 (`entityHref`).

Files: new `src/mocks/services/alerts.ts` (+ test); new `src/features/alerts/{queries,actions}.ts`
(+ tests); new `src/features/alerts/components/{alert-list,alert-item,alert-snooze-menu}.tsx` (+ tests);
`src/features/shell/queries.ts` (+ `queries.test.ts`); `src/components/app/alerts-bell.tsx` (+ new
`alerts-bell.test.tsx`); `src/i18n/messages/{es,en}/alerts.json`; `src/i18n/messages/{es,en}/shell.json`
(block `alerts`, add-only). No other file.

- [x] `listAlerts` (`AlertsService`): the nine rules of PRD §7.9 over the store with "today" =
      `todayInCaracas(ctx.now)`: invoice overdue; invoice due within 7 days with balance > 0; installment
      `PENDIENTE` due in ≤ 7 days or past; document expiring within its `alertDaysBefore` (default 30);
      document `VENCIDO`; recurring expense `PENDIENTE` due in ≤ 5 days or past; payment
      `PENDIENTE_VERIFICACION` older than 2 days; confirmed payment with unallocated > 0 older than 15
      days; no VES rate today on a business day. Amounts compared with `compareMoney`; keys with
      `buildAlertKey`. Dismissed (`dismissedUntil = null`) and snoozed (`> now`) alerts of the current user
      are left out. Types filtered by role: finance types only when `canSeeFinancials(user)`, document
      types when `can(read, document)`, the missing rate when `can(read, settings)`.
- [x] `dismissAlert`, `snoozeAlert` (1–90 days), `restoreAlert` on `alertDismissals` for `ctx.user.id`.
- [x] Adapters: dismiss/snooze/restore and `listAlertsAction` with `"authenticated"` (the caller's own
      alert state and a role-filtered read; DT-71 interpretation, the Code Reviewer confirms).
- [x] `features/shell/queries.ts`: `alertCount` = `listAlerts(ctx, { limit: 1 }).total`.
- [x] `AlertList` (icon per type, title and context from i18n with ICU days, `MoneyText`/`DateText`, link
      through `entityHref`, dismiss, snooze menu 1/3/7 days, undo toast through `restoreAlert`); compact
      variant for the bell, full variant for overviews (props: `types`, `limit`).
- [x] **PD-5** `AlertsBell`: when opened, the panel loads the list through `listAlertsAction`; empty state
      kept when there is none; "Marcar leídas" unchanged (H1-B5).
- [x] **R16** counter badge readable in both themes (≥ 4.5:1 at its size) without editing
      `globals.css`; if a token change is unavoidable, stop and report. State the measured ratios.
- [x] Tests: each rule at its boundary (day 7 vs 8, 2 vs 3 days, 15 vs 16, balance `0.00` vs `0.01`,
      weekend without a rate), dismiss/snooze/restore per user, role filtering, shell count, bell panel
      load, badge classes.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.8 — *Documentos* tab: minimal documents service and the attach sheet

Package 2.8 → Agent: wedevs-developer · haiku — Reason: a tab, a sheet and a minimal CRUD over existing contracts and the existing uploader; the documents module proper is H1-B4.

Use the shadcn MCP.

Depends on: 1.1 (document rows and files), 1.3 (`entityHref`, `item`).

Files: new `src/mocks/services/documents.ts` (+ test); new `src/features/documents/{queries,actions}.ts`
(+ tests); new `src/features/documents/components/{entity-documents-tab,attach-document-sheet,document-row-actions}.tsx`
(+ tests); `src/i18n/messages/{es,en}/documents.json` (keep `validation`). No other file.

- [x] Minimal service with PRD §12 names (H1-B4 extends this file): `listDocuments` (by linked entity
      through the `clientId` / `projectId` facets of `documentFilterSchema` — the contract has no generic
      entity pair; a tab for another type → stop and report; category/type facets; archived left out;
      rows `DocumentRow` / `DocumentVersionRow` / `DocumentLinkRow` assembled into DTOs), `createDocument` (`ARCHIVO` format only here; type rules
      through `createDocumentInputSchemaFor`; `DOC-####`; `CREATE`, `UPLOAD`, `LINK`), `linkDocument`,
      `unlinkDocument` (`UNLINK`; other links untouched, HU-20 CA2). No `searchDocuments` service (not a
      `DocumentsService` name, C9): `searchDocumentsAction` reads `listDocuments` with `q`.
- [x] Adapters: `{ create, document }`, link/unlink `{ update, document }` (Member CRU),
      `searchDocumentsAction` (`{ read, document }`).
- [x] `EntityDocumentsTab({ entity })` per wireframe 4.6: category chips with counts (from
      `listDocumentCategories()`, no input; file chips follow the 2.3 attachment composition, see "Wave 1
      facts"), table (code, title,
      type, status badge, version, updated), "Adjuntar documento" `sheet` with two modes — upload a new
      file (`Uploader`, 25 MB general context; type grouped by category; title; dates per the type rules)
      or link an existing document (`AsyncCombobox`); unlink through `ConfirmDialog`; Viewer read-only.
      Document links go to `/documents/[id]` (in-shell 404 until H1-B4, declared).
- [x] Tests: list by entity, attach new and link existing, unlink keeps other links, permission per role,
      oversize and disallowed files refused by the uploader context, ES and EN.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.9 — Wave 2 coherence fixes: services, grants, server-only icons (Planner F3, F6–F10, F12)

Package 2.9 → Agent: wedevs-developer · sonnet — Reason: removes a C15 breach in the projects mock service, sets one C19 read rule across three services, tightens a DT-71 grant and adds a server-only module; service-level changes H2-B3 reproduces.

Depends on: 2.1–2.8 (merged). Runs after the Wave 2 Code Review (its findings on these files join this package), before the Tester.

Files: `src/mocks/services/{projects,notes,tags,clients,contacts,documents}.ts` (+ tests; `clients`, `contacts`, `documents` added by the Code Review); `src/mocks/services/{documents,alerts}.test.ts` (type tests only);
new `src/features/technologies/icons.ts` (+ test); `src/features/technologies/components/tech-stack-icons.tsx`;
`src/features/technologies/actions.ts` (+ `actions.test.ts`); `src/app/(app)/settings/technologies/page.tsx`. No other file.

- [x] **F3 (C15).** `projects.ts`: delete `money()`; money sorters return the stored USD decimal string (the `listRows` numeric collation orders non-negative 2-decimal strings correctly, as `clients.ts` does). Test: `"10.00"` sorts after `"9.00"` both directions.
- [x] **F6 (C19 shape).** `getProject` and `getNote` answer `NOT_FOUND` for an archived record unless `can(ctx.user, "restore", "trash")`, the same rule as `getClient`. Tests per role.
- [x] **F7 (C12 shape).** `createTag` logs `CREATE` and `updateTag` logs `UPDATE` (with `diffFields` over `name`, `color`) on entity type `TAG` through `mockTx` + `logActivity`. Tests.
- [x] **F8.** Move `resolveTechnologyIcon` and `ResolvedIcon` to new `src/features/technologies/icons.ts` starting with `import "server-only"`; `tech-stack-icons.tsx`, `actions.ts` and the settings page import from it. `resolveTechnologyIconAction` permission becomes `{ action: "read", resource: "settings" }`. Test: Member → `FORBIDDEN`.
- [x] **F9.** `notes.ts:116` field error uses `VALIDATION_MESSAGES.invalidOption`.
- [x] **F10.** `projects.ts:564` unknown link id → `ServiceError("NOT_FOUND")` without the id as a message.
- [x] **F12.** Type tests: projects `satisfies Omit<ProjectsService<MockServiceContext>, "getProjectFinancials">`; notes `satisfies NotesService<MockServiceContext>`; alerts `satisfies AlertsService<MockServiceContext>`; documents `satisfies Pick<DocumentsService<MockServiceContext>, "listDocuments" | "createDocument" | "uploadVersion" | "linkDocument" | "unlinkDocument">`.
- [x] **CR-B1 (C14/C19).** `createNote`, `linkNote`, `createDocument` and `linkDocument` refuse an archived target (client, contact, project, document) with `NOT_FOUND` (checked locally; `entity-refs.ts` stays read-only). Tests per type.
- [x] **CR-B2 (C14/C23).** `createNote`, `updateNote`, `createProject` and `updateProject` require every `image` `fileId` inside rich-text content to be a `READY` file; notes add those ids to `attachmentFileIds`. Tests.
- [x] **CR-B3 (C16).** `projectHeadline` never converts with today's rate; mark it as an H1-B2 placeholder that H1-B3 replaces with the `lib/finance` §8.4.4 summary. Test: a non-USD plan does not move when a new rate is added.
- [x] **CR-B4 (C1).** Tag and technology diffs in clients, contacts, projects and notes log sorted names joined with ", " (snapshot at log time), not ids. Tests.
- [x] **CR-m7.** Document `LINK`/`UNLINK` entries carry `metadata.entityType` / `metadata.entityId` (as notes do).
- [x] **CR-n1.** Add the `// MOCK` header to `alerts.test.ts`.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.10 — Wave 2 coherence fixes: ConfirmDialog, entity-tab props, documents search, technology picker (Planner F1, F2, F4, F5)

Package 2.10 → Agent: wedevs-developer · haiku — Reason: extends a UI pattern backward-compatibly and adapts components and one read action over existing contracts; no service, money or validator change.

Use the shadcn MCP.

Depends on: 2.1–2.8 (merged). Same fix wave as 2.9 (no shared file). Runs after the Wave 2 Code Review, before the Tester.

Files: `src/components/patterns/confirm-dialog.tsx` (+ test); `src/i18n/messages/{es,en}/patterns.json` (add-only, block `confirm`);
`src/features/technologies/components/{technologies-table,technology-picker}.tsx` (+ tests);
`src/features/documents/{actions,queries}.ts` (+ tests); `src/features/documents/components/{entity-documents-tab,attach-document-sheet,document-row-actions}.tsx` (+ tests);
`src/i18n/messages/{es,en}/{catalogs,documents}.json` (only to delete keys this package leaves unused, both languages, and add-only key `technologies.picker.inactive`). No other file.

- [x] **F2.** `ConfirmDialog`: add variants `delete` and `unlink` (`patterns.confirm.variants.{delete,unlink}.{title,description,action}`, ES and EN); optional `description?: string` (already translated; replaces the variant description, e.g. record name or the client cascade warning); optional `options?: { id: string; label: string }[]` rendered as checkboxes, returned as `ConfirmResult.options: Record<string, boolean>`. `extraCheckboxLabel` / `extraChecked` keep working unchanged (`notes-feed.tsx` untouched). Tests: two options returned, description override, reset on reopen.
- [x] Switch the technology **delete** confirmation (`technologies-table.tsx`) and the document **unlink** confirmation (`document-row-actions.tsx`) to `ConfirmDialog` (`delete` / `unlink`, `description` with the name). The in-use lock notice with "Desactivar" stays an `AlertDialog` composition (a lock notice, not a confirmation).
- [x] **F1.** `EntityDocumentsTab({ entity }: { entity: EntityRef })`; inside, only `CLIENT` / `PROJECT` are served (any other type renders nothing). `listEntityDocuments` and `AttachDocumentSheet` accept `EntityRef` the same way; `DocumentsTabEntity` is removed or becomes internal.
- [x] **F4.** `searchDocumentsAction`: input `{ q }` (trimmed, ≤ 200), returns `EntityRef[]` (≤ 20, `{ id, code, label: title, type: "DOCUMENT" }`) built from `listDocuments`; the attach sheet maps `EntityRef` → `AsyncComboboxOption` (`value: id, label, description: code`). Grant unchanged `{ read, document }`.
- [x] **F5.** `TechnologyPicker` gains `selected?: readonly TechnologyChipDTO[]` (the record's current stack): a selected id not among the active `technologies` renders as a removable chip marked inactive (`catalogs.technologies.picker.inactive`, ES and EN) and is never offered for a new selection. Tests.
- [x] **CR-m5.** The attach sheet uses registry `Field` / `FieldLabel` / `FieldError` (C3), wires `aria-invalid` and `aria-describedby`, and maps server `fieldErrors` onto fields (frontend-patterns §6).
- [x] **CR-m6.** `TechnologyPicker` exposes the selected state to assistive technology (`aria-checked` or sr-only text). Test.
- [x] Gate. Commit messages without any Claude attribution. *(2026-10-10, wedevs-developer 2.10: lint, typecheck, i18n:check and build pass; full `pnpm test` had 23 jsdom/load failures in 15 files, and every failing file passes when re-run alone; lockfile and package.json unchanged. Deviations: the unlink dialog description reuses `documents.tab.unlink.description`, which names no document, because this package may only delete keys from `documents.json`; `DateField` takes `aria-invalid` only and `Uploader` takes no `aria-describedby`, so those fields carry only what they accept; `DocumentLinkTarget` is computed in both the tab and the sheet because a client module cannot export a helper the server tab calls. The shadcn MCP reported no registries configured, so the `field` item was checked with `pnpm dlx shadcn@4.21.4 view field`.)*

#### Package 2.11 — Wave 2 code-review fixes: activity labels, rich-text editor, bell panel (CR-B4 UI, m1–m4)

Package 2.11 → Agent: wedevs-developer · sonnet — Reason: changes the C4 rich-text kit's controlled-value behaviour and keyboard model, plus accessibility semantics; borderline for haiku.

Use the shadcn MCP.

Depends on: 2.1–2.8 (merged). Same fix wave as 2.9 and 2.10 (no shared file). Runs before the Tester.

Files: `src/features/activity/components/{activity-diff,activity-detail-sheet}.tsx` (+ tests); `src/i18n/messages/{es,en}/activity.json` (add-only `fields.*`); `src/components/ui/rich-text/{rich-text-editor.tsx,rich-text-toolbar.tsx,extensions.ts}` (+ test); `src/components/app/alerts-bell.tsx` (+ test); `src/features/alerts/components/{alert-list,alert-item}.tsx` (+ test); `src/i18n/messages/{es,en}/alerts.json` (add-only). No other file.

- [x] **CR-B4.** `activity.fields.*` covers every field the W2 services diff (ES and EN: `taxId`, `country`, `fullName`, `position`, `isPrimary`, `tagIds`, `technologyIds`, `pinned`, `nameEn`, `slug`, `category`, `iconSlug`, `color`, `active`, `technology`, and any other the services log); the technology `category` value is labelled from `enums.TechCategory`; a test fails on an unlabelled field.
- [x] **CR-m1.** `isAllowedRichTextUri` uses the validator's link rule; an unparsable document (bad `mailto:`, over `RICH_TEXT_MAX_BYTES`) reports an invalid state (e.g. `onChange(null)` or `onInvalid`) instead of silently keeping the last valid value. Tests (`mailto:x`, oversize document).
- [x] **CR-m2/m3.** `aria-invalid` and the `Field` `aria-describedby` go on the `role="textbox"` element; the toolbar follows the toolbar keyboard pattern (roving focus, e.g. the Radix Toolbar primitive from `radix-ui`) or drops `role="toolbar"`. Keyboard component test.
- [x] **CR-m4.** Bell: "Marcar leídas" stays disabled until H1-B5; the popover is labelled by its title (`aria-labelledby`); focus moves to the next alert or the list after dismiss or snooze; dismiss/snooze labels include the alert subject.
- [x] **CR-nit.** `ActivityDetailSheet` keeps the last entry while it closes (no cut animation).
- [x] Gate. Commit messages without any Claude attribution.

#### Package 2.12 — Wave 2 Tester fixes: activity sheet focus, technologies search (T1, T2)

Package 2.12 → Agent: wedevs-developer · sonnet — Reason: focus management across a Radix Sheet and a client/server
data-refresh path; both need judgement about React 19 / Next 16 behaviour, not a mechanical edit.

Use the shadcn MCP.

Depends on: 2.1–2.11 and the Tester spec (ac43e63) merged. Approved by the user 2026-10-10 ("todo en orden, procede").

Files: `src/features/activity/components/{activity-feed,activity-item,activity-detail-sheet}.tsx` (+ tests);
`src/features/technologies/components/technologies-table.tsx` (+ test); `src/app/(app)/settings/technologies/page.tsx`
(+ test) only if the fix needs it; `src/features/tags/components/tags-table.tsx` (+ test) only if T2 reproduces there;
`tests/e2e/h1-b2-w2.spec.ts` (remove the two `test.fail()` marks and their defect comments only). No other file;
`src/components/ui/**` stays read-only (the shallow `useTableUrlState` is the kit's contract).

- [x] **T1.** Closing the activity detail sheet (Escape, the close button or the overlay) returns focus to the
      "Ver detalle de …" trigger that opened it, also after "load more" re-renders the list. Component test asserts
      `document.activeElement` is the trigger after Escape.
- [x] **T2.** Typing in the `/settings/technologies` search (and changing sort, page, page size, the archived toggle or
      a facet) updates the rows and the total to the filtered set for the URL query; reloading the URL shows the same
      result. Server-resolved icons still render for the new rows. Component test proves the rows follow the query.
- [x] **T2 (tags).** `tags-table.tsx` checked for the same defect; fixed with the same approach if it reproduces, or
      stated as unaffected (with the reason) in worker_done.
- [x] E2E: the two `test.fail()` marks removed from `tests/e2e/h1-b2-w2.spec.ts` (the Orchestrator re-runs the spec in
      phases B and C; the developer runs no browser).
- [x] Gate. Commit messages without any Claude attribution.

#### Wave 2 close

- [x] **Integration checklist:** 2.1–2.8 merged; no Claude attribution; worktrees removed; lockfile
      unchanged; lint, typecheck, test, `i18n:check`, build pass. *(2026-10-10: merges e752971 (2.7), aeae46f (2.1), 4ae7838 (2.2), 3d9f977 (2.8), 99af613 (2.4), 4ce9384 (2.6), 13a58a6 (2.3), 3445623 (2.5 incl. fix round r1: LINK/UNLINK activity and `actions.test.ts`, missing in the first delivery). HEAD 3445623: 179 files, 2355 tests + 1 expected fail; lint, typecheck, i18n:check (32 namespaces), build pass; lockfile and package.json unchanged; no Claude attribution.)*
- [x] **Planner coherence review:** every mock service exports the PRD §12 names and contract signatures
      (C9); no W2 service imports another W2 service; actions use real grants except the DT-71 cases
      listed above; export actions use the 1.2 factory with sources matching `columns.ts`; search actions
      return `EntityRef` options the kit's `AsyncCombobox` accepts; `EntityNotesTab`,
      `EntityDocumentsTab` and `EntityActivityTab` share one prop shape (`entity: EntityRef`); `TagPicker`
      and `TechnologyPicker` emit the id lists the client and project inputs expect; alert rules match
      §7.9; `/settings/tags` and `/settings/technologies` override the `[section]` placeholder and enforce
      access; namespaces in both languages. *(2026-10-10, Planner: READY FOR CODE REVIEW. Pass: C9 names/signatures, no W2 service imports another, grants (DT-71 cases only), export sources = `columns.ts`, alert rules = §7.9, settings pages override `[section]` and enforce access, i18n parity. Findings: F1 entity-tab prop shapes differ and F2 `ConfirmDialog` lacks `delete`/`unlink`/`description`/`options` (W3 blockers) → 2.10; F3 projects money sorted with `Number()` (C15) → 2.9; F4 `searchDocumentsAction` shape → 2.10; F5 inactive technologies invisible in the picker → 2.10; F6 archived project/note readable by every role → 2.9; F7 tag create/update without activity → 2.9; F8 icon resolver without `server-only` and `"authenticated"` → 2.9; F9, F10 error keys → 2.9; F11 CSV money columns for every reader → H2-B3 (W3 screen rule); F12 type tests → 2.9; nits F13–F15 accepted or deferred. The other reported deviations accepted. W3 facts and H2 obligations recorded.)*
- [x] **Code review:** C1, C2, C3 (no hand-written registry equivalents; editor and timeline are
      compositions), **C4** (editor, viewer, paste, links, images), C5, C6, C7, C8, C9, C10 (incl. DT-71 and
      the alert-dismissal interpretation), C11 (no `new Date()` in services), C12 shape (activity entries),
      C15, C16 shape, C19 shape (client cascade, technology lock, archived filtering), C20, C23 shape,
      C25; accessibility of the editor toolbar, the activity sheet, the bell panel and the attach sheet. *(2026-10-10, Code Reviewer, HEAD 08eefe1: BLOCKED until 2.9–2.11 merge. Blockers: B1 archived link targets accepted (notes, documents); B2 rich-text `image` fileIds never checked; B3 project headline converts with today's rate (C16); B4 activity diff shows raw field keys and id arrays (C1) → 2.9 (B1–B4 service side) and new 2.11 (B4 labels). Minor: m1–m4 editor value/a11y, toolbar keyboard, bell panel → 2.11; m5 attach-sheet `Field` + m6 picker selected state → 2.10; m7 document link metadata → 2.9; m8 raw IP to the browser → H2-B3; m9 `getClientFinancials` without `canSeeFinancials` → H1-B3/H2-B3; m10 alerts ignore archived finance rows → H1-B3. Nits: `// MOCK` header → 2.9; ICU instead of `": "` concatenation → H1-FX; documents tab counts capped at 100 → H1-B4; restored project loses a deleted technology → H2-B3. Fine: C4, C10/DT-71 (alerts "authenticated" confirmed), C11, C19, C20, C15/C16 in clients, C5, C25, activity sheet a11y, R16. Registry consulted with `shadcn@4.21.4 search` (MCP unavailable); editor and timeline are legitimate compositions.)*
- [x] **Fix round 2.9–2.11 integrated and re-reviewed.** *(2026-10-10: merges 278d21d (2.11), ccaeb7b (2.9), 9b80127 (2.10); no Claude attribution; worktrees removed; lockfile and package.json unchanged. HEAD 9b80127: 180 files, 2409 tests + 1 expected fail, no flake; lint, typecheck, i18n:check (32 namespaces), build pass. Deviations accepted: 2.9 edited `tech-stack-icons.test.tsx` (resolver tests moved to `icons.test.ts`), non-USD plans add 0 to the placeholder headline (C16, H1-B3 replaces it); 2.10 shadcn CLI instead of MCP, unlink confirmation without the document name, `DateField`/`Uploader` without `aria-describedby`; 2.11 `onInvalid` prop, Radix Toolbar composed with installed Toggle/Button. Code Reviewer re-check: **READY FOR TESTING**, every 2.9–2.11 checkbox met in code and tests. Minor: `note-composer.tsx` ignores `onInvalid` / `aria-describedby` and its `FieldError` has no id → 3.3; `DateField`/`Uploader` accept no `aria-describedby`/`aria-invalid` → H1-FX; unlink confirmation without `{name}` → H1-B4; missing tests for bell `aria-labelledby`, attach-sheet server `fieldErrors`, dismiss/snooze labels with the subject → Tester (E2E) / H1-FX. Nits: non-READY content image error lands on `attachmentFileIds`, removed images stay attachments in `updateNote`, image-id collector and tag-name snapshot duplicated → H2-B3; `mailto` rule duplicated in `rich-text/extensions.ts` → H1-FX; documents archived-target tests miss DOCUMENT/NOTE → H1-B4; inactive-technology chip button name lacks "remove" → H1-FX.)*
- [x] **User confirms the Tester may run.** Confirmed 2026-10-10 ("corre los test"); afterwards the app is left
      running on :3000 for the user's review.
- [x] **Tester scope:**
  - Unit: `vitest run --coverage` (report every W2 mock service and `components/ui/rich-text/**`),
    `i18n:check`, build.
  - E2E (`tests/e2e/h1-b2-w2.spec.ts`, written by the Tester), local only, three phases per
    `safeguards.md` rule 1 (A: no server; B: start worker runs `next start` on a free port, polls with a
    60 s timeout, reports; C: test worker runs Playwright once, then stops the server and frees the
    port): `/settings/tags` (create, rename, recolour; Member and Viewer get the in-shell 404);
    `/settings/technologies` (create with `nameEn`, EN shows `nameEn`, delete in use refused and
    deactivate offered — HU-06 CA3, delete unused works); `/activity` (filters in the URL, detail sheet,
    load more, CSV download with BOM; Member gets the in-shell 404); bell counter equals the panel list;
    dismiss and snooze lower the counter.
  - Accessibility: keyboard through the editor toolbar (component test), the activity sheet and the
    bell panel; dark-mode badge contrast.
  - **Result (Tester, haiku, 2026-10-10, three phases per safeguards rule 1):** Phase A (worker, no server): install,
    lint, typecheck, i18n:check (32 namespaces), build pass; one `test:coverage` run 180/180 files, 2409 tests + 1
    expected fail, no flake. W2 mock services 89.3–99.3 % statements (documents 89.3, activity 90.6);
    `rich-text/**` 73.8 % statements, toolbar 34 %. Spec `tests/e2e/h1-b2-w2.spec.ts` written (b76c727, 21 tests).
    Phase B (Orchestrator): `next start` on :3105, ready in 1 s. Phase C (worker): 19 pass, 0 fail, 2 `test.fail`;
    shell regression `h1-b1-shell.spec.ts` 16/16; spec-only fix 7b073e0 (alerts focus target, dark-mode setup);
    server stopped, port freed. Merged ac43e63; gate re-run green. Defects:
    - **T1 (major)** the activity detail sheet does not return focus to its "Ver detalle de" trigger after Escape
      (`activity-detail-sheet.tsx`, `activity-feed.tsx:107-111`; `document.activeElement` is BODY) (`test.fail`).
    - **T2 (major)** the `/settings/technologies` search only changes `?q=`; the table keeps all 25 rows
      (`use-table-url-state.ts:93`, shallow `useQueryStates`, no refetch or filtering) (`test.fail`).
      `tags-table.tsx` uses the same hook and was not verified.
    - Coverage gaps (not gated): rich-text toolbar 34 %, documents service 89.3 %.
  - **Re-test after 2.12 (2026-10-11):** 2.12 merged 11f3817 (no Claude attribution, in scope, worktree removed);
    gate green: 180 files, 2411 tests + 1 expected fail, lint, typecheck, i18n:check, build. Phase B (Orchestrator)
    `next start` on :3105; phase C (Tester, haiku, read-only, no commits): `h1-b2-w2.spec.ts` 21/21 with no
    `test.fail`/skip left, T1 and T2 pass; `h1-b1-shell.spec.ts` 16/16. Server stopped, :3105 freed; the review app on
    :3000 restarted on the 11f3817 build.
- [x] **Problem report** (Developers, Planner, Code Reviewer, Tester — "none" stated explicitly).
      *(Developers: 2.5 returned once (LINK/UNLINK activity, missing `actions.test.ts`) → r1; 2.8 and 2.10 used the
      shadcn CLI because the MCP did not connect; jsdom timeouts under load in phone-input/country-combobox/date-field/
      faceted-filter/documents tests (→ H1-FX), none in the final runs; 2.12 none (tags table unaffected: it already
      reloads through `listTagsAction`). Planner: F1–F10, F12 fixed in 2.9/2.10; F11 → H2-B3; nits F13–F15 accepted or
      deferred. Code Reviewer: B1–B4, m1–m7 fixed in 2.9–2.11; m8 → H2-B3, m9 → H1-B3/H2-B3, m10 → H1-B3; re-check
      minors: `note-composer` `onInvalid`/`aria-describedby` → 3.3, `DateField`/`Uploader` aria and `mailto` helper →
      H1-FX, unlink `{name}` and documents tab counts → H1-B4, nits → H2-B3, non-USD headline placeholder → H1-B3.
      Tester: T1 and T2 fixed in 2.12 and re-tested green; coverage gaps (rich-text toolbar 34 %, documents service
      89.3 %, not gated) → H1-FX.)*
- [x] **Summary** written by the Orchestrator. *(Wave 2 delivered the mock services and UI building blocks of the
      commercial core: clients/contacts and projects services, the rich-text kit and notes, the activity timeline and
      `/activity`, tags and technologies (services, pickers, `/settings/tags`, `/settings/technologies`), the alerts
      service and live bell, and the documents tab; plus the coherence/code-review fix round 2.9–2.11 and the Tester
      fix 2.12. Twelve packages (2.1–2.12) and the Tester E2E spec merged into `batch/h1-b2-commercial-core` at
      11f3817; gate green (2411 tests), E2E 21/21 + shell 16/16.)*

🛑 **MANDATORY STOP** — wave 3 does not start without the user's explicit approval.

---

### WAVE 3 — Screens: clients, projects, notes

**Objective:** the module screens composed only of W1–W2 outputs and the kit: clients (with contacts),
projects (with links, stack and transitions) and the notes module, with the cross-entity tabs, finance
slots, archive/restore, CSV export and per-page titles.

**Shared-file owners (wave 3):**

| Shared file / area | Owner |
|---|---|
| new `src/app/(app)/clients/**`, new `src/features/clients/components/**`, new `src/features/contacts/components/**`, i18n `clients`, `contacts` | 3.1 |
| new `src/app/(app)/projects/**` (no `[id]/billing`, H1-B3), new `src/features/projects/components/**`, i18n `projects` | 3.2 |
| new `src/app/(app)/notes/**`, `src/features/notes/components/**` (keep the exported props of `EntityNotesTab` unchanged), new `src/features/notes/components/note-link-picker.tsx`, i18n `notes` | 3.3 |
| every `queries.ts`, `actions.ts`, `columns.ts`, mock service, validator, kit, pattern, shell and config file | nobody (read-only; a needed change → stop and report) |

**Cross-package rule (wave 3):** 3.1 and 3.2 import `EntityNotesTab` from the W2 file that 3.3 edits;
3.3 keeps its exported props (`entity: EntityRef`) and behaviour, so the imports stay valid after the
merge.

**Wave 2 facts every W3 package builds on (Planner coherence review, 2026-10-10; assumes 2.9 and 2.10 merged):**

- Roles in pages: read the user with `requireSessionUser()` (`src/server/auth/session.ts`) and gate with `can()` / `canSeeFinancials()` (`src/server/auth/permissions.ts`); client components receive booleans as props (R13). Existing helpers: `canReadActivity()`, `getDocumentPermissions()`, `getNotesViewer()`.
- Cross-entity tabs: `<EntityNotesTab entity={ref} />`, `<EntityDocumentsTab entity={ref} />`, `<EntityActivityTab entity={ref} />`, `ref: EntityRef` = `{ type, id, code, label }` built from the detail DTO; all three are async server components. Render the *Actividad* tab trigger only when `canReadActivity()`. `EntityDocumentsTab` serves `CLIENT` and `PROJECT` only.
- Search actions: `searchClientsAction({ q })`, `searchContactsAction({ q, clientId? })`, `searchProjectsAction({ q })`, `searchDocumentsAction({ q })` → `ActionResult<EntityRef[]>` (≤ 20, archived excluded). `AsyncCombobox` takes `AsyncComboboxOption`: map `{ value: ref.id, label: ref.label, description: ref.code }`. Project clients with roles: `AsyncCombobox multiple` + `secondaryInput` (role) → `clients: { clientId: o.value, role: o.secondary || undefined }[]`.
- `TagPicker` is controlled with `TagChipDTO[]`: initialise from `dto.tags`, submit `tagIds = value.map((t) => t.id)`; `canCreate` is computed on the server and passed as a prop. Bulk tag = one `assignTagsAction({ entityType, entityId, tagIds })` per selected row (no bulk contract); a role that cannot update the entity gets `FORBIDDEN` from the service.
- `TechnologyPicker`: `value` = technology ids, `technologies = listActiveTechnologies()`, `selected = project.stack` (shows inactive ones already on the project). `TechStackIcons` is a server component: render it from RSC only, never inside a client component.
- `RichTextEditor`: pass `uploadAdapter` from `@/features/files/upload-adapter` (without it pasted images are not uploaded); `RichTextView content={doc}`.
- Export: `useCsvExport(<module>CsvAction, "<ENTITY>")`. Facet ids and kinds must equal the sources': clients `status`, `kind`, `country`, `tagId` (async), `created` (dateRange → `createdFrom`/`createdTo`); projects `status`, `clientId` (async), `technologyId`, `tagId`, `delivery` (→ `deliveryFrom`/`deliveryTo`), `withoutBillingPlan`; notes `authorId` (async), `tagId` (async), `linkedEntityType`, `createdAt` (→ `createdFrom`/`createdTo`). Column ids = `CLIENT_COLUMN_IDS` / `PROJECT_COLUMN_IDS` / `NOTE_COLUMN_IDS`; any other column (select, actions) sets `meta.exportable: false`. Without `canSeeFinancials` the USD columns are not rendered at all (so they are never exported; server-side redaction is H2-B3, C13).
- Archive: `archiveClientsAction` / `archiveProjectsAction` are all-or-none; one locked row → `INTEGRITY_LOCK` and nothing archived; re-send with `confirm: true`. The client cascade warning goes in `ConfirmDialog`'s `description`. `restoreClientAction` may answer `CONFLICT` with `error.entity`.
- Projects: `upsertProjectLinksAction` appends new links at the end of their group (input `order` ignored for new links); order changes go through `reorderProjectLinksAction({ projectId, group, orderedLinkIds })`. `setProjectStatusAction` returns `{ project, hints }`; hints render from `projects.hints.<HINT>`. `CANCELADO` uses `ConfirmDialog` with `options` `[cancelPendingInstallments, finishRecurringCharges]` and sends `confirm: true`.
- Detail reads: `getClient`, `getProject` and `getNote` answer `NOT_FOUND` for an archived record unless the user may restore (trash); the page calls `notFound()`.
- 3.3: switch `NoteCard`'s hand-drawn tag badges to `TagChips` (`src/features/tags/components/tag-chips.tsx`).

#### Package 3.1 — Clients and contacts screens

Package 3.1 → Agent: wedevs-developer · haiku — Reason: screens composed of the existing kit, patterns and the W2 queries/actions; the rules live in the 2.1 service.

Use the shadcn MCP.

Depends on: 1.2 (`useCsvExport`), 1.3 (breadcrumb label, `FinanceTabSlot`, `entityHref`), 2.1, 2.2
(projects of a client), 2.3, 2.4, 2.5 (`TagPicker`), 2.7 (`AlertList`), 2.8, 2.9, 2.10.

Files: new `src/app/(app)/clients/{page,loading}.tsx`, `clients/list/page.tsx`, `clients/new/page.tsx`,
`clients/[id]/page.tsx`, `clients/[id]/edit/page.tsx`; new `src/features/clients/components/**` and
`src/features/contacts/components/**` (+ tests); `src/i18n/messages/{es,en}/{clients,contacts}.json`.

- [x] `/clients` overview (`OverviewLayout`, `OverviewTableToggle`): count by status; top 5 by revenue and
      clients with overdue balance (finance roles only); recently created; `AlertList` (invoice overdue,
      due soon, unallocated credit — finance roles); quick action "Nuevo cliente".
- [x] `/clients/list`: `DataTable` with `clients/columns.ts`; facets status, kind, country, tag, created
      range; search; sort; column preferences (`table:clients:columns`); "Mostrar archivados"
      (Owner/Admin); bulk tag (`TagPicker` + `assignTagsAction`), bulk archive (`ConfirmDialog` variant `archive` with the
      cascade warning as `description`, `confirm` flag), export (`useCsvExport(exportClientsCsvAction)`); financial columns
      hidden without `canSeeFinancials`; empty state with CTA.
- [x] `/clients/new` and `/clients/[id]/edit` (`FormPage`, RHF + `zodResolver` with the create/update
      schemas): kind; legal name required for `EMPRESA` (HU-03 CA1); tax id with the VE hint;
      `CountryCombobox`; `PhoneInput`; address; email; website; status; `TagPicker`; unsaved-changes guard.
      On `CONFLICT` the tax-id field shows the error with a link to `entityHref(error.entity)` (HU-03
      CA3); on success a toast and the detail page.
- [x] `/clients/[id]`: `DetailHeader` (initials, code chip, name, status, tags, meta, Detalle | Grafo,
      Editar, More: change status, archive with the cascade confirmation, restore when archived with
      `ArchivedBanner`); `BreadcrumbLabel`; side panel with key data and `FinancialSummaryCard` (finance
      roles); `DetailTabs` (`?tab=`, counts): Resumen (data, highlighted contacts, metrics), Contactos
      (table and dialog to add/edit, set primary, archive; read-only for Member/Viewer, HU-04), Proyectos
      (`RelatedMiniTable` from `listProjects({ clientId })`, "+ Nuevo" → `/projects/new?clientId=`,
      HU-05 CA3), Facturas and Pagos (`FinanceTabSlot`, finance roles), Documentos
      (`EntityDocumentsTab`), Notas (`EntityNotesTab`), Actividad (`EntityActivityTab` when
      `can(read, activity)`). Unknown id, or archived for non-admins → `notFound()`.
- [x] `generateMetadata` titles on every page (R15). Strings only from i18n (C1).
- [x] Tests: `EMPRESA` legal-name rule, `CONFLICT` link rendering, tabs per role, contact primary toggle,
      archive dialog sends `confirm`.
- [x] Gate. Commit messages without any Claude attribution. *(2026-10-11, wedevs-developer 3.1: lint, typecheck, test (185 files, 2429 tests + 1 expected fail), i18n:check (32 namespaces) and build pass; lockfile and package.json unchanged; one approved exception: `listClientsAction` added to `clients/actions.ts` with its test, by the coordinator decision.)*

#### Package 3.2 — Projects screens

Package 3.2 → Agent: wedevs-developer · haiku — Reason: screens over the kit, the rich-text kit, the pickers and the 2.2 actions; the transition rules live in the service and the contract.

Use the shadcn MCP.

Depends on: 1.2, 1.3, 2.1 (client search), 2.2, 2.3 (`RichTextEditor`/`View`, `EntityNotesTab`), 2.4,
2.5, 2.6 (`TechnologyPicker`, `TechStackIcons`), 2.7, 2.8, 2.9, 2.10.

Files: new `src/app/(app)/projects/{page,loading}.tsx`, `projects/list/page.tsx`, `projects/new/page.tsx`,
`projects/[id]/page.tsx`, `projects/[id]/edit/page.tsx`; new `src/features/projects/components/**`
(+ tests); `src/i18n/messages/{es,en}/projects.json`.

- [x] `/projects` overview: projects by status (registry `chart`), upcoming deliveries, without billing
      plan, top technologies, highest to invoice (finance roles), `AlertList` (installments to invoice —
      finance roles).
- [x] `/projects/list`: columns of `projects/columns.ts` (stack as icons); facets status, client (async),
      technology (HU-06 CA2), tag, delivery range, without billing plan; bulk tag/archive; export.
- [x] `/projects/new` (`?clientId=` prefill) and `/projects/[id]/edit`: name; clients (`AsyncCombobox`
      multi with a per-client role input, ≥ 1, HU-05 CA1–CA2); summary ≤ 280 with a counter; description
      (`RichTextEditor`); dates; stack (`TechnologyPicker`); links editor; tags; unsaved-changes guard.
      Status is not edited here (transition dialog).
- [x] Links editor (HU-07): collapsible cards per `ProjectLinkGroup`; add/edit/remove rows (label, URL with
      the field error on invalid URLs, CA3); drag reorder within a group with `@dnd-kit` sortable,
      keyboard sensor and i18n announcements (CA2, persisted through `reorderProjectLinksAction` on the
      detail page); favicon from `https://<host>/favicon.ico` with the group icon as fallback (no
      third-party favicon service); open in a new tab; copy URL with a toast.
- [x] `/projects/[id]`: header (code, name, status, tags, Detalle | Grafo, Editar, "Cambiar estado", More:
      archive); `BreadcrumbLabel`; side panel (clients with roles, dates, stack, financial headline for
      finance roles); tabs: Resumen (`RichTextView`, clients, dates, stack), Enlaces, Cobro / Facturas /
      Gastos (`FinanceTabSlot`, finance roles), Documentos, Notas, Actividad.
- [x] Transition dialog (HU-08): targets from `PROJECT_STATUS_TRANSITIONS`; start date required for
      `EN_CURSO`, end date for `ENTREGADO`; `CANCELADO` through `ConfirmDialog` with `options`
      (cancel pending installments, end recurring charges, CA3); returned hints shown as non-blocking
      warnings.
- [x] Member: edit allowed, no create or archive; Viewer read-only. `generateMetadata` titles (R15).
- [x] Tests: client role input and ≥ 1 rule, summary counter, link URL error, keyboard reorder,
      transition dialog per target, role gating. *(Keyboard reorder through the dnd-kit sensor is not
      exercised in jsdom — arrow buttons and the pure reorder helper are unit-tested; the sensor path is
      covered by the Tester E2E HU-07 CA2. Planner W3 F10.)*
- [x] Gate. Commit messages without any Claude attribution.

#### Package 3.3 — Notes module and tags in the composer

Package 3.3 → Agent: wedevs-developer · haiku — Reason: a table, a form page and a detail over the 2.3 notes kit and actions plus the 2.5 picker.

Use the shadcn MCP.

Depends on: 1.2, 1.3, 2.1 (client/contact search), 2.2 (project search), 2.3, 2.5, 2.8 (document search), 2.9, 2.10.

Files: new `src/app/(app)/notes/page.tsx`, `notes/new/page.tsx`, `notes/[id]/page.tsx`;
`src/features/notes/components/**` (edit `note-composer.tsx`; new `notes-table.tsx`,
`note-link-picker.tsx`, `note-detail.tsx`; + tests); `src/i18n/messages/{es,en}/notes.json`.

- [x] `/notes`: global table (title or derived title, excerpt, author, linked entity chips through
      `entityHref`, tags, attachment count, pinned, created/updated); facets author, tag, linked entity
      type, created range; search; export (`exportNotesCsvAction`); bulk tag; per-row archive with the
      own-notes rule.
- [x] `/notes/new`: the composer as a full page with `NoteLinkPicker` (type CLIENT / CONTACT / PROJECT /
      DOCUMENT + `AsyncCombobox` over the W2 search actions; H1-B3 adds INVOICE / PAYMENT / EXPENSE),
      prefill from `?entityType=&entityId=`, tags.
- [x] `/notes/[id]`: detail and edit (title, content, tags, links add/remove with the last-link guard,
      pin, attachments, archive with the own-notes rule).
- [x] `NoteComposer` gains `TagPicker` (create and edit); `EntityNotesTab` props and behaviour unchanged.
- [x] `NoteComposer` wires the editor's `onInvalid` (an invalid or oversize document blocks saving with an error) and `aria-describedby` to an `id` on its `FieldError` (W2 re-review minor).
- [x] `generateMetadata` titles (R15).
- [x] Tests: filters, link picker prefill, tags on create, last-link guard message, Member archive own
      only.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 3.4 — Wave 3 review fixes: projects (CR B2, B3; Planner F1, F3; m1–m3)

Package 3.4 → Agent: wedevs-developer · sonnet — Reason: the archive confirm round-trip on `INTEGRITY_LOCK`,
dnd-kit accessibility and the shared URL-state loader need judgement, not a mechanical edit.

Use the shadcn MCP.

Depends on: 3.1–3.3 merged (934b99e). Approved by the user 2026-10-11 ("procede"). Runs in parallel with 3.5
(disjoint files).

Files: `src/features/projects/components/**` (+ tests); `src/features/projects/table-filter.ts` (+ test) and a
new `src/features/projects/detail-tabs.ts` (+ test);
`src/app/(app)/projects/list/page.tsx`, `src/app/(app)/projects/[id]/page.tsx`; `src/i18n/messages/{es,en}/projects.json`.
Not `projects/new` or `projects/[id]/edit` pages (3.5).

- [x] **B2.** Project archive (bulk and detail header) sends without `confirm` first; on `INTEGRITY_LOCK` the
      dialog shows `projects.errors.archiveNeedsConfirm` and a second confirmation re-sends with
      `confirm: true`. Tests for both entry points.
- [x] **B3.** dnd-kit `screenReaderInstructions` (and announcements) of the links editor come from i18n
      keys, es+en. Test.
- [x] **F1.** `?tab=` values in English through an exported `PROJECT_DETAIL_TAB_VALUES` (`summary`, `links`,
      `billing`, `invoices`, `expenses`, `documents`, `notes`, `activity`); unknown value → `summary`.
- [x] **F3.** `/projects/list` reads its URL state with the same loader/pattern as `/clients/list`
      (`?archived`, `q` cap, one bad part does not reset the whole query).
- [x] **m3.** `/projects/list` "Mostrar archivados" (`showArchivedToggle`, `includeArchived`) for
      `can(restore, trash)` only (C19).
- [x] **m1.** Focus returns to the opener after `ProjectTransitionDialog`, `ProjectCancelDialog` and the
      project bulk dialogs close (reuse the `useOpenerFocus` approach). Test.
- [x] **m2.** `aria-describedby` from each field to its `FieldError` id in `project-form` and
      `project-status-dialogs`.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 3.5 — Wave 3 review fixes: clients, notes, tag grants (CR B1; Planner F2–F6; m1, m2, nits)

Package 3.5 → Agent: wedevs-developer · haiku — Reason: localized edits with known targets (a column id, a
schema swap, a prop gate, a shared grant helper).

Use the shadcn MCP.

Depends on: 3.1–3.3 merged (934b99e). Approved by the user 2026-10-11 ("procede"). Runs in parallel with 3.4.

Files: `src/features/notes/components/**`, `src/app/(app)/notes/**`; `src/features/clients/components/**`,
`src/features/contacts/components/**`, `src/app/(app)/clients/**`; `src/features/tags/queries.ts` (one new
helper + test); `src/app/(app)/projects/new/page.tsx`, `src/app/(app)/projects/[id]/edit/page.tsx`;
`src/i18n/messages/{es,en}/{notes,clients,contacts}.json` (+ tests everywhere touched).

- [x] **B1.** Notes table attachment column id = `"attachments"` (`NOTE_COLUMN_IDS`); CSV export succeeds. Test.
- [x] **F4.** One server helper `canCreateTagsInline()` in `tags/queries.ts` mirroring the `createTagAction`
      grants (any of create settings, update client, update project, create note, create document); used by
      the clients pages, the notes pages and `projects/new` + `projects/[id]/edit`. Test per role.
- [x] **F5.** `projects/[id]/edit` renders `BreadcrumbLabel` with the project label.
- [x] **F2.** The client *Proyectos* tab shows "+ Nuevo" only when `can(create, project)`.
- [x] **F3.** `/notes` reads its URL state with the `/clients/list` loader pattern.
- [x] **F6.** Note edit validates with the update schema; clearing the title is sent (not dropped). Test.
- [x] **m1.** Focus returns to the opener after the notes archive `ConfirmDialog` (table row and detail).
- [x] **m2.** `aria-describedby` from each field to its `FieldError` id in `client-form` and
      `contact-form-dialog`. *Deviation (coordinator decision, option b):* the two phone fields keep their
      `FieldError` ids but no `aria-describedby`, because the kit's `PhoneInput` has no such prop (kit read-only in
      this wave); deferred to H1-FX with `DateField` and `AsyncCombobox` (same gap, 3.4).
- [x] Nits: "Cambiar estado" hidden on archived clients; note edit shows no success toast when attach or pin
      failed.
- [x] Gate. Commit messages without any Claude attribution.

#### Package 3.6 — Wave 3 review fixes, round 2: server-safe table URL state, client archive lock (CR re-check (a), b, 3–5)

Package 3.6 → Agent: wedevs-developer · sonnet — Reason: a kit split across the client/server boundary (RSC
pages call the URL-state helpers) plus the `INTEGRITY_LOCK` confirm round-trip shared by two features.

Use the shadcn MCP.

Depends on: 3.4 + 3.5 merged (8bb188a). Approved by the user 2026-10-11 ("procede"), **including a kit exception**
limited to `src/components/ui/data-table/{table-url-state.ts,use-table-url-state.ts,index.ts}` (+ tests).

Files: `src/components/ui/data-table/table-url-state.ts` (new), `use-table-url-state.ts`, `index.ts`;
`src/features/clients/components/**`, `src/features/projects/components/**`, `src/components/patterns/**` (only if
the archive dialog is shared there), `src/app/(app)/projects/list/page.tsx`, `src/features/projects/detail-tabs.ts`;
`src/features/tags/{grants.ts (new),queries.ts,actions.ts}`; `src/i18n/messages/{es,en}/{clients,projects,patterns}.json`
(+ tests everywhere touched).

- [ ] **SSR blocker.** `tableUrlParsers`, `TableUrlState`, `guardPageSize`, `listQueryToUrlState`,
      `urlStateToListQuery`, `patchToUrlState` move to a server-safe `table-url-state.ts` (no `"use client"`, parsers
      from `nuqs/server`); `use-table-url-state.ts` keeps the hook and re-exports them; RSC pages import from the
      server-safe module. `/clients/list`, `/projects/list` and `/notes` render rows under `next start`.
- [ ] **(a)** Client archive sends without `confirm` first; on `INTEGRITY_LOCK` shows the lock message and re-sends
      with `confirm: true` (same flow as `ProjectArchiveDialog`, ideally one shared dialog). Test.
- [ ] **(b)** Projects bulk tag `canCreate` comes from `canCreateTagsInline()` via the list page and `ProjectsTable`.
- [ ] **3.** One exported grants constant shared by `createTagAction` and `canCreateTagsInline()`.
- [ ] **4.** Unused `parseProjectDetailTab` / `projectDetailTabHref` removed.
- [ ] **5.** Project link label `Input` gets a `FieldError` id + `aria-describedby`; stray blank line in
      `client-form.tsx` removed.
- [ ] Gate. Commit messages without any Claude attribution.

#### Wave 3 close

- [x] **Integration checklist:** 3.1–3.6 merged (3.3 d027bb1, 3.1 1b5255d, 3.2 934b99e, 3.4 766b0ed, 3.5 8bb188a,
      3.6 72adac7); no Claude attribution; worktrees removed; lockfile unchanged; lint, typecheck, test (201 files,
      2513 passed + 1 expected fail), `i18n:check` (32 namespaces), build pass. Approved exceptions:
      `listClientsAction` / `listProjectsAction` in `actions.ts` (T2 reload pattern); 3.2 new helper files
      `src/features/projects/{link-rows,load-project,table-filter}.ts`; 3.4 `detail-tabs.ts`; 3.6 kit exception
      (`data-table/table-url-state.ts`). 3.6 merge took `TASK.md` from the base (the worker's edit duplicated
      ~2000 lines). **Lesson:** jsdom does not enforce the client/server boundary — a `"use client"` kit helper
      called from RSC pages broke `/clients/list`, `/projects/list` (error boundary) and `/notes` (500) while
      the gate was green; the Orchestrator now smoke-checks list pages under `next start` and reads the server
      log (a 200 is not enough). After 3.6: three lists render 25 rows, clean log.
- [x] **Planner coherence review:** NEEDS FIX → 3.4/3.5. F1 project `?tab=` English values; F2 client
      *Proyectos* "+ Nuevo" gated; F3 URL-state loader pattern for projects and notes; F4 one inline tag grant;
      F5 edit breadcrumb; F6 note edit update schema; F10 3.2 Tests box (keyboard reorder → E2E HU-07 CA2).
      Deferred: F7 title concat, F9 client projects tab page size → H1-FX; F8 archived projects restore →
      H1-B5. Rulings: author facet → H1-B5; CONTACT prefill, `DateField` clear → H1-FX; DOCUMENT prefill →
      H1-B4; money in the RSC payload for non-finance roles → H2-B3.
- [x] **Code review:** first pass BLOCKED (B1 notes CSV column id; B2 projects archive bypassed the
      `INTEGRITY_LOCK`; B3 dnd instructions not i18n) → 3.4/3.5. Re-check BLOCKED on (a) clients archive also
      bypassed the lock (since 3.1) + the SSR blocker → 3.6. Final re-check (72adac7): READY FOR TESTING.
      Deferred to H1-FX: kit `aria-describedby` forwarding (`PhoneInput`, `DateField`, `AsyncCombobox`); kit
      `ConfirmDialog` focus return and moving `useOpenerFocus` out of clients; m6 raw ISO dates in the project
      header; m7 stale-response guard in tables; N1 stray blank line `client-form.tsx:263`; N2 plural
      `archiveNeedsConfirm` for bulk; N3 one shared archive-with-lock dialog. m4 archived records editable →
      H1-FX/H1-B5.
- [ ] **User confirms the Tester may run.**
- [ ] **Tester scope:**
  - Unit: `vitest run --coverage`, `i18n:check` (ES/EN parity), build.
  - E2E (`tests/e2e/h1-b2-*.spec.ts`, written by the Tester), local only over mocks, three phases per
    `safeguards.md` rule 1 (start worker: `next start` on a free port, 60 s readiness timeout; test
    worker: Playwright once, then stop the server and free the port; "Reset mock data" before each
    spec):
    - HU-03: CA1 required fields (legal name only for `EMPRESA`); CA2 new code `CLI-####` follows the
      highest; CA3 duplicate tax id + country → error with a link that opens the existing client; CA4
      `CREATE` visible in the *Actividad* tab.
    - HU-04: CA1 name + email or phone; CA2 marking a primary unmarks the previous one.
    - HU-05: CA1 no save without a client; CA2 role per client; CA3 project listed in each linked
      client's *Proyectos* tab.
    - HU-06: CA1 picker shows only active technologies grouped by category; CA2 filter "Next.js" on
      `/projects/list`; CA3 (covered in W2, re-run).
    - HU-07: CA1 several `REPOSITORIO` links; CA2 reorder by drag and by keyboard, order kept after
      reload; CA3 invalid URL error on the field.
    - HU-08: CA1 `EN_CURSO` needs a start date; CA2 `ENTREGADO` needs the delivery date; CA3 `CANCELADO`
      offers both options; CA4 `STATUS_CHANGE` in *Actividad*.
    - HU-23: CA1 author, date, tags and several attachments kept; CA2 one note linked to a client and a
      project shows in both feeds.
    - HU-29: CA2 no edit or delete control on any activity entry; a client edit shows its field diff.
    - Shapes: archive a client with active projects (confirmation, contacts archived), restore it, and
      "Mostrar archivados" (HU-28 shape); `/clients/list` column visibility kept after reload and CSV
      with BOM, all filtered rows and only visible columns (HU-27 shape); *Documentos* tab attach and
      unlink (HU-20 shape).
    - Roles through "View as role": Member edits a project but cannot create one or archive a client,
      archives only own notes, sees no finance tabs or columns; Viewer sees no write action.
    - Navigation sweep: every H1-B2 route renders in the shell with a translated title; unknown ids → the
      in-shell 404 with status 404; `/clients/[id]/graph` → in-shell 404 (H1-B5).
  - Accessibility and responsive: keyboard through the client and project forms, detail tabs, dialogs and
    the links reorder; ES ↔ EN on a detail page (dates and money reformat, HU-30 CA1); desktop and tablet
    820×1180 without horizontal page scroll; dark-mode contrast spot-check.
  - Manual pass (embedded browser): clients and projects golden path in both themes and languages.
- [ ] **Problem report** (Developers, Planner, Code Reviewer, Tester — "none" stated explicitly).
- [ ] **Summary** written by the Orchestrator.

🛑 **MANDATORY STOP** — H1-B2 closes only with the user's explicit approval; then the batch close below.

### H1-B2 batch close

- [ ] User approves the H1-B2 close after reviewing the UI locally with `pnpm dev`.
- [ ] **Deferred to the end of Hito 1 (DT-69):** push `batch/h1-b2-commercial-core`, PR, CI, deploy
      preview, merge by the user. Until then H1-B3 branches from `batch/h1-b2-commercial-core`.

## H1-B3 — Finance UI (outline)

- **Objective:** finance catalogs, accounts, billing plans, invoices (**multi-rate lines**, DT-44),
  payments + allocations, expenses + recurring, and finance tabs in client/project details. PRD
  §8.4–§8.8, §8.15, §9 as amended by DT-44. HU-09–HU-17 (UI). Invariants: C1–C10, C15, C16 shape, C17,
  C19 shape, C25.
- **Waves (tentative):**
  - W1: `src/lib/finance/**` pure calculators — multi-rate invoice totals (C17 formula, per-rate
    ±0.01 adjustments), §9.4–§9.7, §8.4.2, monthly normalization — + `src/mocks/derive-finance.ts`,
    ≥ 90 % coverage — sonnet; finance catalog settings screens (currencies, rates with quick daily load
    and CSV import, fiscal incl. allowed VAT rates, payment methods, expense categories) — haiku.
  - W2 vertical slices, fixtures computed through `lib/finance`: accounts — sonnet; billing — sonnet;
    invoices (overview, table, form with the **line grid** — per-line VAT rate select incl. "Exento",
    line discount — "Facturar cuotas" wizard, live totals with one row per VAT rate, `PdfViewer` "Archivo"
    tab, void) — sonnet; payments (allocations, IGTF proposal, duplicate warning, receipt viewer) —
    sonnet; expenses + recurring — sonnet. Reason: financial actions are critical and survive into
    Hito 2.
  - W3: wire finance tabs and financial cards into client and project details — haiku.
- **Tester:** money scenarios over mocks (HU-09 CA1 40/30/30 of 10,000; an invoice with lines at 16 %,
  8 %, 0 % and exempt → per-rate bases/IVA and total match C17; ±0.01 adjustment accepted and 0.02
  rejected; HU-12 status transitions; HU-13 CA2 100/3/0 → 97 allocatable, 100 net; HU-13 CA4 VES→USD;
  HU-15 running balance; HU-16 CA1); coverage of `lib/finance`; local E2E of HU-09, HU-11, HU-13 UI.
- **From H1-B2 W2 review:** `projectHeadline` delegates to `lib/finance` per §8.4.4 (proportional collected, adjustments, `toInvoice` only `FIJO`/`MIXTO`); **open question for the Planner:** the USD value of a non-USD contract (§10 has no snapshot on the billing plan); the client financial card calls `getClientFinancials` only when `canSeeFinancials`; alerts leave out archived finance rows once the finance DTOs carry `archivedAt`.

🛑 **MANDATORY STOP** between every wave.

## H1-B4 — Documents and portal UI (outline)

- **Objective:** document categories/types settings, documents module, markdown editor, share links
  (create from document/client/project; per-document **access key** toggle with generate/regenerate shown
  once; list; detail with QR, revoke, counters incl. failed unlocks, access table), public portal
  `/s/[token]` over mock links with the wireframes' brand (DT-51), `PdfViewer`, **unlock dialog and
  lockout state** for key-protected documents (DT-45), generic 404 page, print view. PRD §8.9, §8.11,
  §14 as amended by DT-45/DT-50. HU-18–HU-22 (UI). Invariants: C1–C10 (incl. `definePublicAction`), C4,
  C19 shape, C22 shape, C23 shape, C25.
- **Waves (tentative):**
  - W1: shared `MarkdownView` with `rehype-sanitize` + print stylesheet/letterhead — sonnet (C4);
    document types/categories settings — haiku.
  - W2: documents slice (overview, table, forms, detail, versions/diff/restore, statuses) — haiku;
    markdown editor — haiku; share links slice (mock tokens from a CSPRNG, version pinning, access-key
    management; mock keys hashed even in the mock store) — sonnet; portal `/s/[token]` + unlock action
    via `definePublicAction` + generic 404 — sonnet (public surface, C22).
- **Tester:** local E2E of HU-18 (autosave without version, publish N+1, compare, restore; script/iframe
  not executed), HU-19 UI, HU-20, HU-21, HU-22 CA2–CA4 and CA6 over mocks; key-protected document:
  view/download blocked until the correct key, wrong key error, lockout after 5 failures; portal mobile
  layout; PDF toolbar.
- **From H1-B2 W2 review:** `createDocument` with a file must be atomic (no version-less `BORRADOR` left linked when the upload fails); category chips filter and count over all documents (not one page capped at 100); `LINK`/`UNLINK` entries carry target metadata.

🛑 **MANDATORY STOP** between every wave.

## H1-B5 — Intelligence UI (outline)

- **Objective:** dashboard, entity graph (`/<entity>/[id]/graph`) and global graph, reports and KPIs
  (IVA per rate), Cmd+K results, alerts bell panel, trash, company and users settings. PRD §7.6, §7.7,
  §7.9, §8.1, §8.12, §8.13, §8.15. HU-24–HU-26, HU-28, HU-31, HU-02 CA1 (UI). Invariants: C1–C10, C15,
  C16 shape, C25.
- **Waves (tentative):**
  - W1: KPI formulas in `src/lib/finance/kpis.ts` (§8.13.2) — sonnet; mock services for graph, search,
    dashboard and reports — haiku.
  - W2: graph UI + every `[id]/graph` route — haiku; dashboard — haiku; reports + KPI pages — haiku;
    Cmd+K results + alerts bell panel (shell files under a declared single owner) — haiku; trash,
    company, users settings — haiku.
- **Tester:** local E2E of HU-24 CA1–CA5, HU-25 CA1–CA2, HU-26 CA1–CA3, HU-28 CA1, HU-31 CA2 over mocks;
  graph keyboard alternative; navigation sweep of every PRD §11 route (Hito 1 completeness).

🛑 **MANDATORY STOP** between every wave.

## H1-FX — Fix/change cycle (placeholder)

- One or more **change batches** (`batch/fix-<topic>` or `batch/change-<topic>`) opened from the user's
  review of the Hito 1 UI. Each is usually one package in one wave; the Orchestrator asks the user before
  skipping the Planner for a trivial one.
- [ ] **User's explicit acceptance of the Hito 1 UI** (closes Hito 1; Hito 2 does not open without it).

---

## Hito 2 — implementation blocks (outline)

Every block: waves as usual; schema changes only in a `prisma/` package that is the wave's single
`prisma/` owner; each module swap = replace the import in `queries.ts`/`actions.ts` and delete that
module's mock files in the same package (C9); close with the **Hito 2 deploy gate** above
(`- [ ] Deploy preview verified by the user`).

### H2-B1 — Data foundation

- Prisma 7 schema = PRD §10.2 + approved deltas Δ1 (multi-rate invoices) and Δ2 (access keys)
  (`data-rules.md` §3a), initial migration, complementary SQL (§10.3 + delta CHECKs), `seed.ts`
  (§10.4 + `ivaRates`), optional `seed-demo.ts` (DT-35), `prisma.config.ts`; `src/server/db` with
  **`@prisma/adapter-pg` only** (DT-07), soft-delete extension, transaction and sequence helpers; enum
  parity test (IOU-02). All `prisma/` and db packages: sonnet. The dependency package (Prisma, `pg`
  adapter) is the wave's single lockfile owner.
- CI (sonnet): service tests against a `postgres:17` service container in the job; E2E job against the
  **user's Neon testing database** via `secrets.E2E_DATABASE_URL` (reset with `prisma migrate reset
  --force` at job start, single global concurrency group, skipped when the secret is absent). Agents
  write the YAML only; they never set, read or use the secret or the database (DT-46).
  `netlify.toml` build adds `prisma migrate deploy` (runs in the user's Netlify pipeline).
- Deploy-preview checklist (user): CI E2E job green on the testing DB; preview builds; migrations
  applied on the preview branch by the pipeline; app still runs on mocks.

### H2-B2 — Identity and platform

- Clerk in **`src/proxy.ts`** (DT-33, public routes per DT-42), sign-in with Clerk styled to wireframe
  4.1 without counters (IOU-05), webhook with Svix → `User` sync and `LOGIN`, `session.ts`/`context.ts`
  swap to Clerk + Prisma, `can()` enforcement (C13), `logActivity`, `reindexEntity`, `StorageProvider` +
  presigned uploads/downloads + magic-byte MIME (`confirmUpload` detects the type from magic bytes,
  checks it against the context allowlist and stores the detected type, never the client MIME; downloads
  served with `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` — Code Review
  H1-B1 w2), `/api/files/[id]/download`, preferences (incl.
  `timezone`)/columns/alert dismissals on `UserPreference`/`AlertDismissal`, company settings, users and
  roles, security headers/CSP baseline (`worker-src 'self'`). Origins from `APP_URL` (DT-52). Auth,
  proxy, webhook, storage: sonnet.
- Deploy-preview checklist (user): invited user signs in, uninvited refused (HU-01 CA1); webhook creates
  the user with its role; Member gets `FORBIDDEN` on a financial action (HU-02 CA2); upload and download
  through the preview bucket.

### H2-B3 — Commercial core real

- Services + swap for clients, contacts, projects, links, technologies, tags, notes (+ attachments),
  activity listing, restore of these entities; side effects in the transaction (C12). Routing decided
  when the block opens: sonnet for services with transactional side effects or integrity locks (archive
  cascades, restore conflicts, sequences), haiku for pure catalog CRUD.
- Deploy-preview checklist: HU-03–HU-08, HU-23, HU-29 on real data.
- From H1-B2 W2 review: `clients.service` / `contacts.service` export `searchClients` / `searchContacts` (or the actions switch to `listClients` / `listContacts`); `deleteTechnology` deletes the `ProjectTechnology` rows of archived projects in the same transaction (PRD §10 relation is Restrict); CSV export and list DTOs drop USD fields for roles without `canSeeFinancials` (C13); `archiveNoteAction` revalidates the linked records' paths; the activity service masks the IP (the raw IP never reaches the browser); `getClientFinancials` gated by `canSeeFinancials`; restoring a project does not recover a technology deleted while it was archived (document it).

### H2-B4 — Finance real

- Services + swap for finance catalogs, rates (`getRateFor`, CSV import), accounts, transfers,
  movements, reconciliation, billing, installments, recurring charges (`generateMissingPeriods`),
  invoices with **lines and per-rate tax lines** (`recomputeInvoice` rebuilds `InvoiceTaxLine` preserving
  valid ±0.01 adjustments), payments and allocations, expenses and recurring expenses; job step logic
  for overdue invoices and recurring generation; `Serializable`/`FOR UPDATE` (C18); ≥ 90 % coverage on
  invoice, payment, account and billing services. All sonnet.
- Deploy-preview checklist: HU-09–HU-17 money scenarios on real data, incl. a mixed-rate invoice.

### H2-B5 — Documents and portal real

- Services + swap for document types, documents, versions, drafts, links, share links, portal token
  resolution, **access keys** (scrypt hashing, constant-time compare, 5-failures/15-min lockout from
  `ShareAccessLog`, `UNLOCK`/`UNLOCK_FAILED` logging, signed unlock cookie with `SHARE_UNLOCK_SECRET`),
  access log with salted IP hash, portal downloads (`/api/s/[token]/files/[documentId]` checks the
  unlock cookie), portal headers; **Netlify rate limiting** rules for `/s/*` and `/api/s/*` (code-based
  config if the plan supports it; the user enables and verifies it, DT-47); job step logic for document
  expiry and expired links. Portal, tokens, keys, downloads: sonnet.
- Deploy-preview checklist: HU-18–HU-22 on real data, incl. 404 on an altered token, `X-Robots-Tag`,
  key-protected document flow and lockout, rate limiting active.

### H2-B6 — Intelligence and jobs real (retention per DT-74)

- Graph services (cache tag, IOU-01), `searchGlobal` (tsvector + trigram), dashboard/overview
  aggregates, reports and KPIs (IVA per rate from `InvoiceTaxLine`), live alerts with `AlertDismissal`,
  server CSV export (≤ 10k rows, BOM, `EXPORT`), trash listing, `netlify/functions/daily-maintenance` and
  `cleanup-files`, `scripts/recompute-all.ts`; removal of aggregate mocks. Jobs and recompute: sonnet.
- Deploy-preview checklist: HU-10 CA4, HU-12 CA4, HU-19 CA2–CA3 (job run triggered by the user),
  HU-24–HU-28, HU-31.
- From H1-B2 W2 review: `listAlerts` is called through `listAlertsInputSchema`; payment age counts from the payment's business `date`.

### H2-B7 — Hardening and launch (no data migration, DT-75)

- E2E of critical HUs 03, 09, 11, 13, 18, 22, 24 (agents locally; CI on the Neon testing DB; the user on
  the preview); security audit (headers/CSP, authorization of every action, portal and access keys);
  performance targets (§14); WCAG 2.1 AA; Sentry; operations documentation;
  domain and `APP_URL` set by the user before go-live (DT-52); confirm `src/mocks/` deleted and flip the
  ESLint rule (IOU-03).
- Deploy-preview checklist: full regression; then the user's production go-live decision.
