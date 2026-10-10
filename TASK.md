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
| Batch 0 — Rules | rules | Revision 1 applied (user decisions); **awaiting final user approval** |
| H1-B1 — UI foundations | Hito 1 UI batch | Planned in detail below; opens after batch 0 approval |
| H1-B2 — Commercial core UI | Hito 1 UI batch | Outline |
| H1-B3 — Finance UI | Hito 1 UI batch | Outline (multi-rate invoices, DT-44) |
| H1-B4 — Documents and portal UI | Hito 1 UI batch | Outline (access keys DT-45, pdf.js DT-50, brand DT-51) |
| H1-B5 — Intelligence UI | Hito 1 UI batch | Outline |
| H1-FX — Fix/change cycle | change batches | Placeholder; ends with the user's explicit "UI accepted" |
| H2-B1 … H2-B7 | Hito 2 implementation blocks | Outline; each closes with the deploy-preview gate. Open blockers: P3 (H2-B4), P6 (H2-B6), P7 (H2-B7) |

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
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build` pass.

#### Package 2.7 — Global Zod error map to i18n keys, upload extension fallback (wave 2 follow-up, Code Review B2, M2, m2, m6, m7)

Package 2.7 → Agent: wedevs-developer · sonnet — Reason: change to shared validators (contract for every form and Server Action) and upload checks (file security, C23).

Files: `src/lib/validators/common.ts`, `src/lib/validators/files.ts`, `src/lib/validators/zod-config.ts`
(new), their tests (`src/lib/validators/*.test.ts`), `src/i18n/messages/{es,en}/validation.json`,
`src/i18n/contract-keys.test.ts`, `src/mocks/session.ts`.

- [ ] One global `z.config({ customError })` in `zod-config.ts`, imported for its side effect by
      `common.ts`; maps Zod issue codes to `validation.*` keys (`invalid_type` → `required` when input is
      `undefined`, else `invalidFormat`; `invalid_value` → `invalidOption`; `too_small`/`too_big` →
      `tooShort`/`tooLong` or numeric `tooSmall`/`tooLarge`; `invalid_format` → `invalidFormat`; fallback
      `invalidFormat`). Custom messages keep precedence.
- [ ] Every generic key is registered in `VALIDATION_MESSAGES`; flat keys in `validation.json` are either
      registered or removed (no orphans), ES and EN in parity; `contract-keys.test.ts` covers them.
- [ ] Test: bad inputs to every exported primitive schema (`idSchema`, `dateOnlySchema`,
      `listQuerySchema`, money/rate/percent/currency, files schemas, a `z.enum` from `enums.ts`) yield
      only messages starting with `validation.`.
- [ ] `checkUpload`: strip MIME parameters; when MIME is empty or `application/octet-stream`, fall back
      to the extension against `allowedExtensions`; tests for `notes.md` with `""` and with
      `application/octet-stream`, and a disallowed extension still rejected.
- [ ] `validation.file.tooLarge` interpolates `{max}` (ES and EN) and `checkUpload` provides it.
- [ ] `common.ts`: one shared sort-token regex constant.
- [ ] `src/mocks/session.ts`: default user declared as its own typed constant (no `as SessionUser`).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build` pass.

#### Wave 2 close

- [x] **Integration checklist:** 2.1, 2.2, 2.3 merged; no Claude attribution; worktrees removed;
      `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build` pass.
      Follow-ups 2.4 (merge 5b93fbe) and 2.5 (merge 9e59339) merged the same way; integrated checks
      re-run green (13 files, 554 tests; i18n parity 32 namespaces; build OK).
- [x] **Planner coherence review:** `enums` namespace keys ↔ `enums.ts` values; `money.ts` schemas ↔
      `lib/money` string conventions; `can()` resources cover every row of §4.3; no overlap.
      First pass NOT READY (B1 missing validation/common.errors keys, B2 scripts tests not in vitest,
      B3 formatMoney throws on USDT) → packages 2.4/2.5; re-check: B1–B3 CLOSED, READY FOR CODE REVIEW.
- [ ] **Code review:** C1, C2, C5, C6, C8, C9, C11 shape, C15, C25.
      First pass CHANGES REQUIRED (B1 `addDays` DST bug, B2 C1 Zod default messages in English;
      M1 fixed-USD i18n format, M2 upload MIME fallback) → packages 2.6/2.7. Deferred: m3 (`can()`
      grants update/delete on `activity`, contradicts C20) → pending `can()` vocabulary decision;
      m4 (date-only check duplicated in `common.ts` and `dates.ts`) → H1-FX.
- [ ] **User confirms the Tester may run.**
- [ ] **Tester scope:** `vitest run --coverage` (report coverage of `money.ts` and `rates.ts`, ≥ 90 %),
      permission matrix test, `pnpm i18n:check`, `pnpm build`. No E2E.
- [ ] **Problem report** (explicit, per agent).
- [ ] **Summary.**

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
| `src/lib/validators/{common,enums,money,files}.ts` | nobody (read-only this wave) |
| `package.json` / lockfile | nobody |

3.1 and 3.2 do **not** import each other's files; cross-module references use `EntityRef` and ids from
`common.ts`.

#### Package 3.1 — Contracts: commercial, knowledge and cross-cutting

Package 3.1 → Agent: wedevs-developer · sonnet — Reason: shared Zod contracts and service DTOs consumed by many modules and by Hito 2 services (PRD §6.4 rule 3), incl. the portal access-key contract (security).

Files: `src/lib/validators/{users,preferences,clients,contacts,projects,technologies,tags,notes,document-types,documents,shares,activity,search,graph,alerts,trash}.ts` and their `*.test.ts`.

- [ ] For each module: create/update input schemas, list-row DTO (the table columns of PRD §8.x),
      detail DTO, filter schema extending `listQuerySchema`, and the input/output types of every PRD §12
      service of the module (exact names, `fn(ctx, input)` shape documented in a type alias).
- [ ] Clients (§8.2): `legalName` required for `EMPRESA`; tax-id format validated when country is `VE`
      (RIF V/E/J/G/P); ISO 3166-1 alpha-2; E.164 phone; status default `PROSPECTO`; financial metrics as
      money strings. Contacts: name + at least one of email/phone; `isPrimary`.
- [ ] Projects (§8.3): ≥ 1 client with optional role; `summary` ≤ 280; transition input with
      `startDate` required for `EN_CURSO`, `endDate` for `ENTREGADO`; links (group enum, label, valid
      URL, order); stack as technology ids only. Technologies and document types/categories with
      `name`/`nameEn`.
- [ ] Notes (§8.10) and tags (§7.5) as specified in the PRD.
- [ ] Documents (§8.9): fields, formats, statuses and transitions (`signedAt` required for `FIRMADO`
      only on types with signature; `expiresAt` only on types with expiration), versions, draft save,
      publish, restore, links.
- [ ] Shares (§8.11 + DT-45): title, message, client, documents with pinned `versionId` or latest,
      **per-document `requiresAccessKey`**, `allowDownload`, locale, expiry; inputs
      `setShareDocumentAccessKey` (generate | regenerate | remove; the clear key is returned **once** in
      the result DTO and never in any read DTO) and `unlockSharedDocument` (token, documentId, key,
      min length 8); share DTOs with counters (views, downloads, failed unlocks) and access-log rows; a
      portal DTO exposing only what the visitor may see, with `locked: boolean` per document (C22).
- [ ] Activity (§8.14), search (§7.6), graph (exactly §8.12.5), alerts (the nine types, `alertKey`,
      dismiss/snooze), trash, users and preferences (role change, invitation input, keys
      `table:<id>:columns`, `locale`, `theme`, `timezone` — DT-43).
- [ ] Tests: each schema accepts a valid example and rejects each rule violation listed above; no read
      DTO of shares contains a key or hash.

#### Package 3.2 — Contracts: finance, catalogs, dashboard and reports

Package 3.2 → Agent: wedevs-developer · sonnet — Reason: money contracts (multi-rate invoices, payments, allocations, accounts, billing, expenses) consumed by every financial screen and service.

Files: `src/lib/validators/{catalogs,settings,billing,invoices,payments,accounts,expenses,dashboard,reports}.ts` and their `*.test.ts`.

- [ ] Catalogs (§8.15): currencies, exchange rates (incl. quick daily load and CSV import row), payment
      methods, expense categories (two-level tree). Settings: company; fiscal with **`ivaRates`** (allowed
      VAT rates, default `["16","8","0"]`), `ivaDefaultRate` (`"16"`), IGTF 3, methods/currencies
      proposing IGTF, invoice due days 15 (DT-44).
- [ ] Billing (§8.4): plan, installments, templates (100, 50/50, 40/30/30, 30/40/30, 3 equal, custom),
      recurring charges (billing day 1–28, lead days default 7), "generate missing periods" input,
      project financial summary DTO (§8.4.4).
- [ ] Invoices (§8.5 + DT-44): header fields (no header VAT rate); **lines** (description, project,
      installment, quantity, unit price, line discount ≤ amount, `ivaRate` from the allowed list or
      `null` = exempt); computed line `amount`/`netAmount`; **tax lines** DTO (rate, base, IVA) with an
      input allowing a ±0.01 adjustment per rate; header totals DTO (subtotal, discount, exempt amount,
      tax base, IVA total, total, withholdings IVA/ISLR/other + note, receivable, USD snapshots); file id;
      draft flag; void input (reason required); list/detail DTOs with balance, USD values, days overdue,
      "partial payment" flag; "invoice installments" wizard input.
- [ ] Payments (§8.6, §9.5, §9.6): fields incl. IGTF, fee, reference (required when the method requires
      it), receipt, status; allocations; duplicate-warning DTO.
- [ ] Accounts (§8.7, §9.7) and expenses (§8.8) as specified in the PRD (masked identifiers,
      `accountAmount`, mark-paid, recurring day 1–28, lead days default 5).
- [ ] Dashboard (§8.1) and reports (§8.13): KPI card DTO, chart series DTOs, report filter schema, report
      and KPI ids; "taxes registered" report DTO with IVA **per rate**.
- [ ] Tests: money fields reject numbers and > 2 decimals; rates > 0; line discount > amount rejected;
      VAT rate outside the allowed list rejected; tax-line adjustment beyond ±0.01 rejected; transfer from
      = to rejected; void without reason rejected; billing day outside 1–28 rejected.

#### Package 3.3 — Kit: data-table

Package 3.3 → Agent: wedevs-developer · haiku — Reason: composition of the registry data-table example over the existing `listQuerySchema` contract.

Use the shadcn MCP.

Files: `src/components/ui/data-table/**` (table, toolbar, faceted filter, filter chips, debounced
search, view options/column config, pagination, selection + bulk bar, export button, empty state,
skeleton, `use-table-url-state.ts`), `src/i18n/messages/{es,en}/table.json`, tests under
`src/components/ui/data-table/`.

- [ ] Follow the registry data-table example (MCP) with TanStack Table, **manual** (server)
      pagination/sorting/filtering; page sizes 25/50/100; state in the URL through `nuqs` parsers that
      round-trip `listQuerySchema` (`frontend-patterns.md` §5).
- [ ] Faceted filters as "+ Field" buttons that become removable chips and "Limpiar"; date-range and
      async-option facets supported via props.
- [ ] Column visibility, order and width; `onColumnsChange` / `initialColumns` props. Multi-select with a
      bulk-action bar. Export button calls `onExport(query, visibleColumns)`. "Show archived" toggle only
      when a prop allows it.
- [ ] Empty state with CTA slot and skeleton rows; sticky header; horizontal scroll with code/name
      pinned on narrow screens.
- [ ] Strings from `table` (C1). Tests: URL state round trip; page-size guard; column state callback.

#### Package 3.4 — Kit: money, rate, combobox, date, phone, country, uploader

Package 3.4 → Agent: wedevs-developer · sonnet — Reason: `MoneyInput`/`RateInput` carry money semantics for every financial form (C15) and the uploader fixes the file-contract boundary (C23).

Use the shadcn MCP.

Files: `src/components/ui/money-input/**`, `src/components/ui/rate-input/**`,
`src/components/ui/async-combobox/**`, `src/components/ui/date-field/**`,
`src/components/ui/phone-input/**`, `src/components/ui/country-combobox/**`,
`src/components/ui/uploader/**`, `src/i18n/messages/{es,en}/forms.json`, tests next to each component.

- [ ] `MoneyInput`: currency select + amount text input holding a decimal string; locale-aware typing
      normalized to the canonical string; live USD equivalent through `lib/money` given a `usdRate` prop;
      works with react-hook-form `Controller`. Never stores a `number` (C15).
- [ ] `RateInput`: `lookupRate(date, currency)` prop; prefill, "Usando tasa del dd/mm" on fallback,
      manual when `null`, USD locked at 1, > 10 % deviation warning.
- [ ] `AsyncCombobox` (single and multi): debounced `loadOptions(q)`, keyboard navigation, optional
      "Crear nuevo" (`onCreate(q)`), grouped options, optional per-item secondary input.
- [ ] `DateField` (`YYYY-MM-DD`, display time zone prop, default Caracas), `PhoneInput` (E.164),
      `CountryCombobox` (ISO alpha-2 with flags, localized names via `Intl`).
- [ ] `Uploader`: drop zone + file list driven by an `UploadAdapter` prop; enforces the context's
      allowlist and size limit (25 MB general, 10 MB payment receipts); no network code of its own.
- [ ] Strings from `forms` (C1). Tests: `MoneyInput` ("1.234,56" in ES → "1234.56"; USD at "755.16");
      `RateInput` fallback and USD lock; uploader rejects a disallowed MIME and an oversize file per
      context.

#### Package 3.5 — Page, overview, detail and form patterns

Package 3.5 → Agent: wedevs-developer · haiku — Reason: presentational compositions of registry components following the wireframes.

Use the shadcn MCP.

Files: `src/components/patterns/**` (`page-header`, `overview-table-toggle`, `overview-layout`,
`kpi-card`, `stat-card`, `detail-header`, `detail-tabs`, `side-panel-card`, `financial-summary-card`,
`related-mini-table`, `status-badge`, `entity-code-chip`, `empty-state`, `confirm-dialog`,
`archived-banner`, `form-page`, `use-unsaved-changes.ts`, `section-card`, `money-text`, `date-text`),
`src/i18n/messages/{es,en}/patterns.json`, tests next to the components.

- [ ] Build each pattern per `frontend-patterns.md` §1, §1a (lucide mapping), §3, §4, §6, §9 and
      wireframes 4.2, 4.4, 4.5: `DetailHeader` with the always-visible **Detalle | Grafo** toggle,
      `DetailTabs` with counts and `?tab=` via `nuqs`, `OverviewTableToggle`, dark `FinancialSummaryCard`.
- [ ] `StatusBadge`: every enum value of `enums.ts` → tone + `enums.*` label; secondary indicator
      ("Pago parcial").
- [ ] `ConfirmDialog`: archive/void/cancel variants, optional required reason, optional extra checkbox.
- [ ] `MoneyText`/`DateText` through `formatMoney`/`formatDate` with the current locale and display zone.
- [ ] `FormPage` (title, sections, sticky footer actions) + `use-unsaved-changes.ts`.
- [ ] Strings from `patterns` (+ `enums`, read-only). Tests: `StatusBadge` covers every enum value;
      `DetailTabs` reads/writes `?tab=`; the unsaved-changes guard fires on a dirty form.

#### Package 3.6 — Kit: PDF viewer (pdf.js)

Package 3.6 → Agent: wedevs-developer · haiku — Reason: UI component over an installed library following the portal wireframe; no data or security logic.

Use the shadcn MCP.

Files: `src/components/ui/pdf-viewer/**`, the `pdfViewer` key block in
`src/i18n/messages/{es,en}/common.json`, tests in `src/components/ui/pdf-viewer/`.

- [ ] `PdfViewer` client component, lazy-loaded, rendering a PDF from a URL with pdf.js (DT-50); toolbar
      per wireframe 4.8: page x / y with previous/next, zoom − / 100 % / +, download (calls an
      `onDownload` prop — the viewer never builds download URLs itself), fullscreen; loading skeleton and
      error state; keyboard-operable toolbar; worker served from the app origin.
- [ ] Works in both themes; fits its container (portal panel, invoice "Archivo" tab, receipts).
- [ ] Tests: toolbar state (page bounds, zoom steps) with pdf.js mocked; `onDownload` called.

#### Wave 3 close

- [ ] **Integration checklist:** 3.1–3.6 merged; no Claude attribution; worktrees removed; lint,
      typecheck, tests, `i18n:check`, build pass.
- [ ] **Planner coherence review:** service names in contracts = PRD §12 (+ portal additions); DTO money
      fields are strings; multi-rate invoice contract matches C17; share read DTOs never expose keys;
      3.1/3.2 do not cross-import; kit props match `listQuerySchema` and `files.ts`; namespaces filled in
      both languages.
- [ ] **Code review:** C1, C2, C3, C5, C6, C8, C15, C22 shape (contracts), C23 shape, C25.
- [ ] **User confirms the Tester may run.**
- [ ] **Tester scope:** `vitest run --coverage` (contracts, kit component tests), `i18n:check`, build,
      a11y spot-check of kit components (labels, keyboard on combobox, date field, PDF toolbar). No E2E.
- [ ] **Problem report** (explicit, per agent).
- [ ] **Summary.**

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
| `package.json` / lockfile | nobody |

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

- [ ] `store.ts` (`// MOCK`): `globalThis` singleton, lazily built from fixtures, one typed collection per
      model the UI needs (incl. `invoiceTaxLines` and share-document key hashes as Δ1/Δ2 shapes);
      `resetMockStore()`; a `derive` hook list for later packages (`data-rules.md` §2).
- [ ] `ids.ts`: stable readable ids and a mock sequence per prefix (`CLI`, `PRY`, `FAC`, `PAG`, `GAS`,
      `DOC`).
- [ ] `fixtures/catalogs.ts`: currencies (USD, VES, EUR, USDT, COP), exchange rates for the last ~90
      days (VES around 755.16, with one missing business day), payment methods, document categories and
      types (§8.9.1), expense categories (§8.8), ~60 technologies, tags, fiscal settings with `ivaRates`
      `["16","8","0"]` and default 16, company settings, mock users. Every row parses with its Zod schema.
- [ ] Module fixture stubs: typed empty arrays under stable names (owned later by module packages).
- [ ] `ctx.ts` + `server/context.ts`: `getServiceContext()` → `{ db, user, now }` and
      `getPublicServiceContext()` → `{ db, user: null, now }` (C11).
- [ ] `define-action.ts`: `defineAction({ permission, input, revalidate, handler })` — session →
      `can()` → Zod → handler(ctx, data) → revalidate → `ActionResult`; maps domain errors; never throws
      to the client (C10).
- [ ] `define-public-action.ts`: `definePublicAction({ input, handler })` — resolve share token through a
      `resolveToken` function supplied by the shares module (generic `NOT_FOUND` on failure, no reason) →
      Zod → handler(publicCtx, { shareLink, data }) → `ActionResult`; never reads the session (C10
      exception). Unit-tested with a stub resolver.
- [ ] Mock services (`fn(ctx, input)`): catalogs (`getRateFor`, `listCurrencies`, `listPaymentMethods`,
      `listTechnologies`, `listDocumentTypes`, `listExpenseCategories`, `listTags`, `getFiscalSettings`),
      preferences (get/set `table:<id>:columns`, theme, timezone), files (`requestUpload` returning a mock
      file id and no upload URL, `confirmUpload`), session (`setMockRole`, `resetMockData`).
- [ ] Features: `shell/queries.ts#getShellData()` (user, latest VES rate with date and missing flag,
      alert count `0` until H1-B2), `preferences` queries/actions, `catalogs` queries + read actions
      (`lookupRateAction`), `files/actions.ts`, `session/actions.ts` (MOCK) — all through `defineAction`.
- [ ] `mock` namespace strings in ES/EN.
- [ ] Tests: `defineAction` order (`UNAUTHENTICATED`; Viewer on a write → `FORBIDDEN`, handler not
      called; bad input → `VALIDATION`; success → revalidate called); `definePublicAction` (unknown token
      → generic `NOT_FOUND`, no session access); store reset; fixtures parse; `getRateFor` fallback;
      ESLint import restrictions hold.

#### Package 4.2 — CI workflow (no database yet)

Package 4.2 → Agent: wedevs-developer · sonnet — Reason: CI workflows are critical by routing (`orca-workflow.md`).

Files: `.github/workflows/ci.yml`.

- [ ] On pull requests and pushes to `main`: checkout, corepack + pnpm, Node from `.nvmrc`,
      `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`,
      `pnpm i18n:check`, `pnpm build`.
- [ ] E2E job (Hito 1, mocks, no DB): install Playwright Chromium, `pnpm build`, start `next start` in the
      background with a readiness poll (fail after 60 s), `pnpm test:e2e --pass-with-no-tests`, always
      kill the server.
- [ ] No secrets, no database, no deploy step, no Netlify/Neon calls. The Neon-testing-DB E2E (DT-46) is
      added in H2-B1. Concurrency group per branch.
- [ ] Validate the YAML locally (e.g. `actionlint` if available; otherwise state that it was not run).

#### Wave 4 close

- [ ] **Integration checklist:** 4.1, 4.2 merged; no Claude attribution; worktrees removed; lint,
      typecheck, tests, `i18n:check`, build pass.
- [ ] **Planner coherence review:** mock service signatures use validator types; context shapes = C11;
      `defineAction` / `definePublicAction` sequences = C10; fixture stubs exported under the names later
      batches will own; CI scripts exist in `package.json`.
- [ ] **Code review:** C5, C7, C8, C9, C10, C11, C15, C25; CI has no secrets or remote calls.
- [ ] **User confirms the Tester may run.**
- [ ] **Tester scope:** `vitest run --coverage`, `i18n:check`, build; dry review of `ci.yml` against
      `package.json` scripts. No E2E yet.
- [ ] **Problem report** (explicit, per agent).
- [ ] **Summary.**

🛑 **MANDATORY STOP** — wave 5 does not start without the user's explicit approval.

---

### WAVE 5 — Application shell, sign-in and settings/preferences

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

- [ ] Root layout providers: `NextIntlClientProvider`, `ThemeProvider`, `NuqsAdapter`, `Toaster`,
      `TooltipProvider`.
- [ ] `src/config/nav.ts`: every sidebar item and group of §7.1 with lucide icons per
      `frontend-patterns.md` §1a, i18n keys, route, and the `can()` resource used to hide it; also feeds
      breadcrumbs and Cmd+K navigation.
- [ ] `(app)/layout.tsx` with registry `sidebar` (collapsible, icon mode, mobile sheet), topbar
      (breadcrumbs, search trigger with `⌘K`, BCV `RateChip`, `AlertsBell` with counter and empty panel,
      locale switcher, theme toggle, `UserMenu`), footer (copyright, version, "Mock data" badge; no
      "Respaldo diario", DT-48). Match wireframes 4.2/4.4 and the brand (DT-51).
- [ ] `UserMenu` (MOCK parts marked): name/role, "View as role", "Reset mock data", sign out (→
      `/sign-in`).
- [ ] `CommandMenu` (registry `command` in a dialog): `⌘K`/`Ctrl+K` and the trigger; navigation from
      `nav.ts`; quick actions filtered by `can()`; results area with an empty state until H1-B5.
- [ ] `(auth)/sign-in/[[...sign-in]]/page.tsx` per wireframe 4.1 **without counters or any data**
      (DT-48); buttons navigate to `/dashboard` (mock). `(app)/dashboard/page.tsx` placeholder.
      Not-found pages in and outside the shell; `(app)/loading.tsx` skeleton.
- [ ] Strings only from i18n (C1); logo from the wireframes (DT-51).
- [ ] Tests: nav items hidden per role via `can()`; command menu opens with the shortcut.

#### Package 5.2 — Settings frame and preferences

Package 5.2 → Agent: wedevs-developer · haiku — Reason: settings screen over the existing preferences actions and kit.

Use the shadcn MCP.

Files: `src/app/(app)/settings/layout.tsx`, `src/app/(app)/settings/page.tsx`,
`src/app/(app)/settings/preferences/page.tsx`, `src/config/settings-nav.ts`,
`src/features/settings/components/**`, `src/i18n/messages/{es,en}/settings.json`, tests.

- [ ] Settings layout with section navigation for all §8.15 sections, hidden per `can()` (users: Owner
      only). `/settings` redirects to `/settings/preferences`.
- [ ] Preferences form: language, theme, time zone (default `America/Caracas`, stored as the `timezone`
      preference, DT-43) saved through `preferences/actions.ts`; language change also sets
      `NEXT_LOCALE` and refreshes; uses `FormPage` and the unsaved-changes guard.
- [ ] Tests: form submits through the action; theme change applies.

#### Wave 5 close

- [ ] **Integration checklist:** 5.1, 5.2 merged; no Claude attribution; worktrees removed; lint,
      typecheck, tests, `i18n:check`, build pass.
- [ ] **Planner coherence review:** nav routes = PRD §11; settings sections = §8.15; shell uses
      `getShellData` (no mock imports in components); icons per §1a; namespaces filled in both languages.
- [ ] **Code review:** C1, C2, C3, C5, C6, C7, C9, C10, C25; accessibility of sidebar, topbar and
      command menu.
- [ ] **User confirms the Tester may run.**
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
- [ ] **Problem report** (explicit, per agent).
- [ ] **Summary.**

🛑 **MANDATORY STOP** — H1-B1 closes only with the user's explicit approval; then the batch-close steps
below.

### H1-B1 batch close

- [ ] `.mcp.json` pinned by the user to the scaffold's `shadcn` version (DT-49 / IOU-04) — confirm it was
      done after wave 1; if not, the Orchestrator raises it again now.
- [ ] User (or the Orchestrator with explicit approval) pushes `batch/h1-b1-ui-foundations` and opens the
      PR.
- [ ] CI green; Netlify deploy preview published (mock UI; mock state may reset on cold start — DT-32).
- [ ] User reviews the preview and merges to `main`. No agent merges.

---

## H1-B2 — Commercial core UI (outline)

- **Objective:** clients, contacts, projects (links, stack, multi-client, transitions), notes,
  technologies and tags settings, `/activity`, and the cross-entity tabs and alert list. PRD §7.2, §7.5,
  §7.7, §7.9, §8.2, §8.3, §8.10, §8.14, §8.15. HU-03–HU-08, HU-23, HU-29 (UI). Invariants: C1–C10, C15,
  C19 shape, C25.
- **Waves (tentative, finalized when the batch opens):**
  - W1 cross-entity components: notes feed + Tiptap editor with sanitized rendering — sonnet (C4);
    activity timeline + diffs + `/activity` + mock `listActivity` — haiku; tags picker + `/settings/tags`
    — haiku; `AlertList` + mock alert rules + dismiss/snooze + alert count in `features/shell/queries.ts`
    (its only shared file) — haiku; `EntityDocumentsTab` + "Adjuntar documento" sheet (wireframe 4.6)
    over a minimal documents mock service — haiku.
  - W2 vertical slices: clients + contacts — haiku; projects (excluding billing) — haiku; notes module
    routes — haiku; `/settings/technologies` — haiku.
- Client Facturas/Pagos tabs and project Cobro/Facturas/Gastos tabs render an empty-state slot until
  H1-B3 wires them (declared cross-batch edit).
- **Tester:** local E2E of HU-03 (incl. duplicate tax-id error with link), HU-04, HU-05, HU-06 CA1–CA2,
  HU-07, HU-08, HU-23, HU-29 over mocks; i18n parity; a11y of forms and tabs.

🛑 **MANDATORY STOP** between every wave; the detailed plan is written when the batch opens.

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
  presigned uploads/downloads + magic-byte MIME, `/api/files/[id]/download`, preferences (incl.
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

### H2-B4 — Finance real (blocked by P3)

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

### H2-B6 — Intelligence and jobs real (blocked by P6 for any retention job)

- Graph services (cache tag, IOU-01), `searchGlobal` (tsvector + trigram), dashboard/overview
  aggregates, reports and KPIs (IVA per rate from `InvoiceTaxLine`), live alerts with `AlertDismissal`,
  server CSV export (≤ 10k rows, BOM, `EXPORT`), trash listing, `netlify/functions/daily-maintenance` and
  `cleanup-files`, `scripts/recompute-all.ts`; removal of aggregate mocks. Jobs and recompute: sonnet.
- Deploy-preview checklist: HU-10 CA4, HU-12 CA4, HU-19 CA2–CA3 (job run triggered by the user),
  HU-24–HU-28, HU-31.

### H2-B7 — Hardening and launch (blocked by P7)

- E2E of critical HUs 03, 09, 11, 13, 18, 22, 24 (agents locally; CI on the Neon testing DB; the user on
  the preview); security audit (headers/CSP, authorization of every action, portal and access keys);
  performance targets (§14); WCAG 2.1 AA; Sentry; data migration per P7; operations documentation;
  domain and `APP_URL` set by the user before go-live (DT-52); confirm `src/mocks/` deleted and flip the
  ESLint rule (IOU-03).
- Deploy-preview checklist: full regression; then the user's production go-live decision.
