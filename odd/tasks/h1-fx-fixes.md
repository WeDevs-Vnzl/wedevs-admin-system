# H1-FX — Fix/change cycle (ODD feature)

H1-FX over mocks: the consolidated backlog of `docs/TASK.md` § "H1-FX — Fix/change cycle" (2026-10-20); it ends with the user's explicit acceptance of the Hito 1 UI.
Branch `batch/h1-fx-fixes` from `main` (`7acf26f`) · delivery `ask-on-risk` (forecast ≫ 400 lines; push/PR deferred to the end of Hito 1, DT-69) · runner: vitest (`fe/node_modules/.bin/vitest`) + Playwright E2E against the user's `next dev` on :3000.

## Specs
- **S0** Scope (L1): "incopora mis cambios y procede". Source of truth: `docs/TASK.md` § "H1-FX — Fix/change cycle", "Consolidated backlog (2026-10-20)". Each item below is quoted from it; the origin batch is in brackets.
- **S1 — Small bugs**:
  - "Date bomb: the "delivery window" test in `features/projects/actions.test.ts` uses a fixed 2026-10-10..2026-10-30 window over data computed from today; the only failing unit test. [B5]"
  - "Restoring a project or note whose client is archived returns no CONFLICT (only contacts do). [B5]"
  - "Cmd+K exact-hit shortcut matches `code` only, not the fiscal `invoiceNumber`. [B5]"
  - "m6: raw ISO dates in the project header. [B2]"
  - "m5: `MoneyInput` accepts extra decimals. [B1]"
- **S2 — Edit routes**: "A5: no `/payments/[id]/edit` and `/expenses/[id]/edit` routes (2 `test.fixme` in the B5 route sweep). [B5]"
- **S3 — Archived read-only**: "A6/m4: archived records are still editable. [B5]"
- **S4 — Form and focus behavior**:
  - "`country-combobox` does not open on ArrowDown; turn the `it.fails` in `country-combobox.keyboard.test.tsx` into a passing test. [B2 audit]"
  - "D5: focus does not return to the contact dialog opener (`h1-b2-w3-notes-roles.spec.ts`, `test.fail`), together with kit `ConfirmDialog` focus return and moving `useOpenerFocus` out of `features/clients`. [B2 audit]"
  - "m7: stale-response guard in tables. [B2]"
  - "CONTACT prefill; clearing a `DateField`. [B2]"
- **S5 — Accessibility**:
  - "Kit `aria-describedby` forwarding in `PhoneInput`, `DateField`, `AsyncCombobox` and `Uploader`; `mailto` helper. [B2]"
  - "N1: `--muted-foreground` → `#686874` in `globals.css`, then drop the sign-in `text-foreground/70` workaround. [B1]"
  - "R14: `SidebarInset` renders a `<main>` that wraps the header and footer. [B1]"
  - "R15: no per-page title template. [B1]"
  - "N4: `aria-labelledby` on the preference radiogroups. [B1]"
  - "Kit: m7 `aria-sort` and row label; m8 link ToggleGroup → ButtonGroup with `aria-current`; m10 phone dial `aria-label`. [B1]"
  - "Dark mode: subtle topbar focus ring; breadcrumb truncation at 820 px (also in Spanish). [B1]"
- **S6 — UI and small features**:
  - "Dashboard: dark "Saldo en cuentas" card; KPI cards link to `/reports`. [B5]"
  - "`AlertList` has no read/unread styling. [B5]"
  - "Company logo preview in settings. [B5]"
  - "N2: favicon `src/app/icon.svg` (today `/favicon.ico` renders the shell 404); user-supplied logo SVG. [B1]"
  - "Restore the `/clients/list` and `/projects/list` loading skeletons. [B2 audit]"
  - "F7: title concatenation; F9: page size of the client projects tab. [B2]"
  - "N2: plural `archiveNeedsConfirm` for bulk; N3: one shared archive-with-lock dialog. [B2]"
  - "Optional: restyle `window.confirm` as a kit dialog. [B1]"
- **S7 — Cleanup and debt**:
  - "Unused: `shell.dashboardPlaceholder.*` keys, `forms.uploader.inputLabel` key, `getShellData().alertCount`. [B1, B5]"
  - "m4: date-only check duplicated in `common.ts` and `dates.ts`. [B1]"
  - "D3 workaround: the global `[data-slot="combobox-content"] { pointer-events:auto }` style injected from feature code moves into the kit or is removed. [B2 audit]"
  - "Shrink the RSC guard ALLOW_LIST (4 kit barrel re-exports). [B2 audit]"
  - "Nits: cast in `features/catalogs/rate-lookup.ts`; `withSortFields` comment wrongly lists `.extend()`; stray blank line at `client-form.tsx:263` (N1). [B1, B2]"
  - "`ClientDetailDTO` embeds `financials` for every role; drop it for roles without `canSeeFinancials` (`getClientFinancials` is already gated server-side, 5cf18e3). [B3]"
- **S8 — Tests**:
  - "Flaky jsdom timeouts in `phone-input` and `country-combobox`; flaky faceted-filter and documents tests. [B2 audit, B2]"
  - "Project archive `INTEGRITY_LOCK` E2E (`h1-b2-w3-projects.spec.ts`, `test.skip`). [B2 audit]"
  - "`async-combobox` debounce test with fake timers; stable callback for the pagination clamp. [B1]"
  - "Coverage below 90 %: `data-table.tsx`, `related-mini-table.tsx`, `use-unsaved-changes.ts`; shell (user-menu, alerts-bell, app-footer, not-found-content, theme-provider, section-placeholder, settings-nav, settings queries); rich-text toolbar (34 %); documents service (89.3 %). [B1, B2]"
- **S9 — Manual and CI (user-owned)**:
  - "HU-25 CA3: ≥ 50 fps with 500 nodes, and the graph layout running in a worker, checked in a real browser. [B5]"
  - "Decide whether `SHARE_IP_SALT` / `SHARE_UNLOCK_SECRET` become GitHub Actions secrets for the CI e2e job. [B5]"
- **S10 — Close**: "**User's explicit acceptance of the Hito 1 UI** (closes Hito 1; Hito 2 does not open without it)."

## Tasks
| ID | Specs | Work | Route | Status |
|---|---|---|---|---|
| T1 | S1 | date bomb, restore CONFLICT, Cmd+K `invoiceNumber`, project header dates, `MoneyInput` decimals | inline | pending |
| T2 | S2 | `/payments/[id]/edit`, `/expenses/[id]/edit`; un-fixme the 2 route-sweep cases | inline | pending |
| T3 | S3 | archived records read-only (edit routes and actions) | inline | pending |
| T4 | S4 | country-combobox ArrowDown, focus return (D5 + `ConfirmDialog`), stale-response guard, CONTACT prefill, `DateField` clear | inline | pending |
| T5 | S5 | accessibility kit and shell fixes | inline | pending |
| T6 | S6 | UI and small features (window.confirm restyle only if the user opts in; logo SVG needs the user's file) | inline | pending |
| T7 | S7 | cleanup and debt | inline | pending |
| T8 | S8 | flaky tests, INTEGRITY_LOCK E2E, debounce test, coverage ≥ 90 % | inline | pending |
| T9 | S0–S8 | independent verifier + E2E sweep | delegated (verifier) | pending |
| T10 | S9, S10 | user: real-browser fps check, CI secrets decision, Hito 1 UI acceptance | user | pending |

## Log
- **L1** (2026-10-20, user): "A1 si se deben saltar los periodos vencidos. incopora mis cambios y procede"
- **L2** A1 was already applied on 2026-10-14 (`odd/tasks/h1-b3-finance-ui.md` L20; `nextOpenPeriod` in `fe/src/mocks/services/expenses.ts:287`); its test passes; the TASK.md status row was corrected (`79cfe73`). The user's uncommitted changes committed as `a77089f` (radii 1.2 → 0.8, `DataTable` frame kept inside cards; data-table and note-composer tests 81/81), `c0fc299`, `57f417f`.
