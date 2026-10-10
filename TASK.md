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
      Open for the user: DT-70, Technology `nameEn`, DT-71; P3, P6, P7, domain and secrets before Hito 2.

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
