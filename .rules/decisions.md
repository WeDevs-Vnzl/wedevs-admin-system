# Decision log

Statuses: **DECIDED (user)** — decided by the user, including amendments to the PRD; **DECIDED (PRD)**
— taken from the PRD; **OPEN** — needs the user; a batch that depends on it does not open until it is
decided. Revision 1 of batch 0 applied the user's answers to every Planner proposal, OP-01…OP-06 and
P2, P5, P8, P9.

Where a user decision amends the PRD, the PRD drift is listed in §8 so the PRD can be updated by the
user; agents follow this file in the meantime.

---

## 1. User decisions on delivery and tooling

### DU-01 — Two milestones instead of the F0–F5 vertical phases — DECIDED (user)

The MVP scope of PRD §3.1 does **not** change; only the delivery **order** of PRD §16 changes.

- **Hito 1 — complete UI with mock data.** At its close the whole app is navigable end to end: every
  route of PRD §11 (`(auth)` sign-in screen; `(app)` layout with sidebar, topbar and Cmd+K; every
  module's overview, table, detail and forms; graph; reports and KPIs; activity; trash; settings),
  ES/EN and light/dark work, users can create/edit/archive against the mock layer within the session,
  and the public portal `/s/[token]` is usable with mock share links. Built as UI batches H1-B1…H1-B5
  followed by a **fix/change cycle** until the user explicitly accepts the UI.
- **Hito 2 — functionality blocks that replace mocks with real logic**, each verified by a **deploy**
  before the next opens: the user pushes and opens the PR, Netlify publishes the deploy preview, the
  user verifies it (gate "deploy preview verified by the user"). No agent deploys or touches Netlify,
  Neon or Clerk (`phase-gates.md` rules 9 and 11).
- Mock layer: DT-32; rules C7–C11 (`conventions.md`), `frontend-patterns.md` §16, `data-rules.md` §2.
- `coverage-matrix.md` keeps the F0–F5 phase of each capability for traceability.

### DU-02 — shadcn MCP mandatory for UI work — DECIDED (user)

Every agent doing UI work consults the shadcn MCP (`.mcp.json`, tool `mcp__shadcn`) before adding or
composing shadcn components; components are installed with the shadcn CLI at a pinned version, never
hand-copied; a component the registry provides is never hand-written. Invariant **C3**;
`frontend-patterns.md` §0. Every UI package spec in `TASK.md` contains "Use the shadcn MCP". The Code
Reviewer verifies it.

---

## 2. Technical decisions from PRD §6.2

| Id | Area | Decision | Status / notes |
|---|---|---|---|
| DT-01 | Framework | Next.js App Router, RSC, Server Actions | DECIDED (PRD); major 16.x per DT-33 |
| DT-02 | Language | TypeScript `strict` | DECIDED (PRD) |
| DT-03 | UI | shadcn/ui + Tailwind CSS + lucide-react | DECIDED (PRD); DU-02 applies; icon mapping in `frontend-patterns.md` §1a |
| DT-04 | Forms | react-hook-form + Zod (`@hookform/resolvers`) | DECIDED (PRD); C8 |
| DT-05 | Tables | TanStack Table, shadcn data-table, server pagination | DECIDED (PRD) |
| DT-06 | URL state | `nuqs` | DECIDED (PRD) |
| DT-07 | ORM | Prisma 7 (`prisma-client` generator, `prisma.config.ts`) with **`@prisma/adapter-pg` in all environments**; no Neon adapter, no Neon-specific code; the system is database-platform agnostic | **DECIDED (user, OP-01) — amends PRD §6.2 and §10.2.1** (drift D1) |
| DT-08 | Database | PostgreSQL with `pg_trgm` and `unaccent`; Neon hosts it as a plain Postgres | DECIDED (PRD), generalized by OP-01 |
| DT-09 | Files | S3-compatible storage (Neon Object Storage, beta) behind `StorageProvider` | DECIDED (PRD); exit plan to R2/S3 by env vars (§15) |
| DT-10 | Uploads | Presigned URL, browser uploads directly to the bucket | DECIDED (PRD) |
| DT-11 | Auth | Clerk, invitation/allowlist only, Google OAuth + email code | DECIDED (PRD) |
| DT-12 | Graph | React Flow + `elkjs` + `d3-force`; layouts in a Web Worker | DECIDED (PRD) |
| DT-13 | Rich text | Tiptap, JSON + plain text | DECIDED (PRD) |
| DT-14 | Markdown editor | CodeMirror 6 + `react-markdown`, `remark-gfm`, `rehype-sanitize` | DECIDED (PRD); C4 |
| DT-15 | Charts | shadcn Chart (Recharts) | DECIDED (PRD) |
| DT-16 | i18n | `next-intl`, cookie + user preference, no route prefix | DECIDED (PRD); file layout DT-31 |
| DT-17 | Theme | `next-themes`, saved per user | DECIDED (PRD) |
| DT-18 | Money | Prisma `Decimal` + `decimal.js`, never float | DECIDED (PRD); C15 from Hito 1 (user) |
| DT-19 | Dates | UTC, `@db.Date`, display `America/Caracas` | DECIDED (PRD); per-user display zone DT-43 |
| DT-20 | Scheduled jobs | Netlify Scheduled Functions | DECIDED (PRD) |
| DT-21 | Toasts | `sonner` | DECIDED (PRD) |
| DT-22 | Observability | Sentry + Netlify logs | DECIDED (PRD); H2-B7 |
| DT-23 | Tests | Vitest + Playwright | DECIDED (PRD); CI boundary DT-46 |

## 3. Assumptions of PRD §17

| Id | Assumption | Status |
|---|---|---|
| DT-24 | An invoice belongs to **one** client, even when it spans several projects. | DECIDED (PRD) |
| DT-25 | Each module has an overview (`/x`) separate from its table (`/x/list`). | DECIDED (PRD) |
| DT-26 | Hourly billing is out until time tracking exists. | DECIDED (PRD) |
| DT-27 | Partner contributions/withdrawals are account movements; no profit-sharing logic. | DECIDED (PRD); see P1 |
| DT-28 | Neon Object Storage is used despite being in beta, behind a swappable interface. | DECIDED (PRD) |
| DT-29 | The BCV rate is entered manually in the MVP. | DECIDED (PRD); see P4 |
| DT-30 | ~~One IVA rate per invoice plus an exempt amount.~~ | **SUPERSEDED by DT-44 (P2, user)** |

## 4. Planner proposals — all DECIDED (user)

| Id | Decision |
|---|---|
| DT-31 | **i18n split by namespace files**: `src/i18n/messages/{es,en}/<namespace>.json`, merged at load by `src/i18n/request.ts` from a fixed list in `src/i18n/namespaces.ts`. H1-B1 creates every namespace file; each module package owns its namespace pair; `common`, `enums`, `validation` get a declared owner per wave. (Drift D3 vs PRD §6.3/§7.8.) |
| DT-32 | **Mock layer**: server-side in-memory store on `globalThis`, seeded from typed fixtures in `src/mocks/`; RSC + `queries.ts` and real Server Actions call **mock services with the PRD §12 names and `fn(ctx, input)` signatures**; mutations persist for the life of the server process and are revalidated; "Reset mock data" and a "Mock data" badge exist only in Hito 1; on Netlify previews the store can reset on cold start (accepted). Removal per module in Hito 2. |
| DT-33 | **Next.js 16 and `proxy.ts`.** The scaffold pins the latest stable 16.x supported by Netlify; the request-interception file is `src/proxy.ts` (Next.js 16 naming). Every rule that said `middleware.ts` refers to `proxy.ts`. Hito 1 has no proxy (next-intl runs without routing). (Drift D4.) |
| DT-34 | **`src/lib/finance/`**: pure isomorphic calculators (C17), used by live form totals, mock services and real services. |
| DT-35 | **Mixed period during Hito 2.** Until H2-B6, cross-module aggregates (dashboard, reports, graph, search, alerts, trash) read mocks; tabs listing another module's records call that module's queries. Stable fixture ids + optional `prisma/seed-demo.ts` keep references consistent. |
| DT-36 | **UI folders**: `src/components/ui/` (registry + shared kit), `src/components/patterns/`, `src/components/app/`. |
| DT-37 | **Action adapters and context**: `src/server/actions/define-action.ts` (C10), `src/server/actions/define-public-action.ts` (portal-only, C10 exception) and `src/server/context.ts`. Shared files, one owner per wave, sonnet. |
| DT-38 | **All Hito 1 dependencies installed in H1-B1** (incl. graph, editors, charts, pdf.js, dnd, QR, diff, phone). |
| DT-39 | **All module contracts written in H1-B1** in two sonnet packages (commercial/knowledge, finance/reports), including the P2 and P5 changes. |
| DT-40 | **`can()` and the permission matrix in Hito 1**, evaluated by `defineAction` against the mock session; MOCK-only "View as role"; real enforcement in Hito 2 (C13). |
| DT-41 | **Upload limits**: 25 MB general (PRD §14); **payment receipts** PDF/PNG/JPG/WEBP up to 10 MB (HU-14). (Drift D7 resolved.) |
| DT-42 | **Public routes**: `/sign-in`, `/s/[token]`, `/api/s/[token]/files/[documentId]`, `/api/webhooks/*`. Portal downloads are public by token, plus the access key when the document requires one (DT-45). (Drift D2.) |

## 5. Decisions taken in revision 1 — DECIDED (user)

| Id | From | Decision |
|---|---|---|
| DT-43 | drift | **Per-user time zone** (PRD §8.15 "Preferencias … zona horaria") is stored as `UserPreference` key `timezone`, default `America/Caracas`; display only. No schema change (drift D5). |
| DT-44 | P2 | **Multiple VAT rates per invoice.** Invoices are split into lines; each line has its own VAT rate (16 %, 8 %, 0 %, or exempt) and an optional line discount; header totals are derived: subtotal, discount, exempt amount, base and IVA **per rate** (IVA adjustable ±0.01 per rate), withholdings, total, receivable, USD snapshots. Formula in `conventions.md` C17; schema delta Δ1 in `data-rules.md` §3a (`InvoiceLine.ivaRate/discount/netAmount`, new `InvoiceTaxLine`, `Invoice.ivaRate` removed, fiscal `ivaRates` list). Amends PRD §8.5, §9.3, §9.8, §10.2 (drift D8). |
| DT-45 | P5 | **Optional per-document access key in the portal.** Within a share link, any document may require a key that the visitor enters before viewing or downloading it. Key hashed with `scrypt` (per-key salt), shown once on creation/regeneration, constant-time compare, failed attempts logged (`UNLOCK_FAILED`) with lockout after 5 failures per link/document/IP hash in 15 min, success logged (`UNLOCK`) and kept in a signed httpOnly cookie scoped to the token paths (`SHARE_UNLOCK_SECRET`, new env var). UI in H1-B4; model and security in H2-B5. The portal keeps the wireframes' aesthetic as the brand image. Schema delta Δ2 (`ShareLinkDocument.accessKeyHash`, `accessKeyUpdatedAt`, `ShareEvent` + `UNLOCK`/`UNLOCK_FAILED`, lockout index). Amends PRD §8.11, §10.2, §6.5 (drift D9). |
| DT-46 | OP-02 | **CI end-to-end tests run against a Neon *testing* database** owned and configured by the user; the GitHub Actions job reaches it only through the user's secret `E2E_DATABASE_URL`. **Boundary:** agents author the workflow YAML but never read, print or set that secret, never connect to that database, and never run E2E against it; agents run E2E only locally (podman Postgres in Hito 2, `next start` with mocks in Hito 1). Service tests in CI use a `postgres:17` service container inside the job (no secret). The E2E job serializes runs (single concurrency group) because the database is shared, resets it with `prisma migrate reset --force` at the start of the job, and is skipped when the secret is absent. `prisma migrate deploy` for previews/production runs in the Netlify build configured by the user (PRD §14). |
| DT-47 | OP-03 | **Portal rate limiting = Netlify rate limiting** on `/s/*` and `/api/s/*` (60 req/min per IP). No Postgres fallback and no Redis unless it proves insufficient later (would be a new decision). The access-key attempt lockout of DT-45 is a separate control based on `ShareAccessLog`. |
| DT-48 | OP-04 | **Wireframe elements:** the sign-in page's live counters are **removed**; "Verificación SAT / IRS OK" and "Respaldo diario" are omitted; the topbar BCV rate chip is kept. |
| DT-49 | OP-05 | **Pin shadcn in `.mcp.json`** to the exact version the scaffold pins. `.mcp.json` is user-owned; the Orchestrator raises it with the user at the H1-B1 wave 1 close (task in `TASK.md`, IOU-04). Until then developers use `pnpm exec shadcn`. |
| DT-50 | OP-06 | **PDF viewer = pdf.js** (`pdfjs-dist`, optionally via `react-pdf`) with the custom toolbar of wireframe 4.8 (page x/y, zoom, download, fullscreen); shared `PdfViewer` kit component; worker served from the app origin (CSP `worker-src 'self'`). Installed in H1-B1. |
| DT-51 | P9 | **Brand identity = the wireframes** (`resources/wireframes`, `resources/example`): logo, monochrome palette, Inter. No separate brand manual. |
| DT-52 | P8 | **No domain for now.** `APP_URL` is a placeholder (the Netlify URL in deployed environments); share URLs and Clerk/CSP origins derive from it. Choosing a domain later is configuration only (user, before launch). |

## 6. Open questions — OPEN

| # | Question (PRD §17, quoted) | Recommendation | Blocks |
|---|---|---|---|
| P1 | "¿Hace falta un reparto formal de utilidades entre socios (porcentajes, liquidaciones periódicas)?" | No for the MVP (DT-27). A "yes" is a scope change. | Nothing, unless "yes". |
| P3 | "¿WeDevs es o será contribuyente especial? Esto cambia el tratamiento del IGTF y de las retenciones." | Keep IGTF/withholdings editable and configurable. | **H2-B4**. Not Hito 1. |
| P4 | "¿Se debe automatizar la obtención diaria de la tasa BCV en la Fase 2?" | Out of the MVP (§3.2). | Nothing in the MVP. |
| P6 | "¿Cuánto tiempo se conservan `ActivityLog` y `ShareAccessLog`? (Propuesta: indefinido y 24 meses, respectivamente.)" | Accept the proposal. | **H2-B6** (retention job, if any). |
| P7 | "¿Hay datos existentes (hojas de cálculo, Drive) que migrar? ¿En qué formato?" | Answer before H2-B7; may require CSV importers (scope). | **H2-B7**. |

Resolved: P2 → DT-44; P5 → DT-45; P8 → DT-52; P9 → DT-51.

### Blocking summary

| Batch | Blocked by |
|---|---|
| H1-B1 … H1-B5 | none |
| H2-B1 | none |
| H2-B2 | none |
| H2-B3 | none |
| H2-B4 | **P3** |
| H2-B5 | none |
| H2-B6 | **P6** |
| H2-B7 | **P7** (and the user's domain choice before go-live, DT-52) |

## 7. IOUs (known follow-ups, not decisions)

- **IOU-01** (H2-B6): PRD §8.12.5 caches `getGlobalGraph` with `unstable_cache` + tag `graph`; use the
  Next.js 16 tagged-cache API with the same semantics (tag `graph` invalidated on every mutation).
  Accepted by the user.
- **IOU-02** (H2-B1): enum parity test between `src/lib/validators/enums.ts` and the Prisma enums,
  including the Δ2 additions.
- **IOU-03** (H2-B7): flip the ESLint `@/mocks` restriction to "forbidden everywhere" and confirm
  `src/mocks/` is deleted.
- **IOU-04** (H1-B1): the scaffold reports the exact pinned versions; the Orchestrator then raises the
  `.mcp.json` pin with the user (DT-49).
- **IOU-05** (H2-B2): Clerk sign-in styled to wireframe 4.1 through `appearance`; if impossible, the user
  chooses between Clerk Elements and the stock look.
- **IOU-06** (user, outside agents): update `orca-workflow.md` and `.claude/agents/*` to DU-01
  terminology and `proxy.ts` (the Orchestrator handles it per the user's instruction).

## 8. PRD drift log (user-approved amendments; the PRD text is the user's to update)

| Id | PRD place | Drift | Decision |
|---|---|---|---|
| D1 | §6.2 ORM row, §10.2.1 `PrismaNeon` snippet, §6.1 diagram | `pg` adapter everywhere, no Neon adapter | DT-07 |
| D2 | §4.2 public routes | `/api/s/[token]/files/[documentId]` is public by token | DT-42 |
| D3 | §6.3, §7.8 `messages/{es,en}.json` | per-namespace message files | DT-31 |
| D4 | §4.2, §14 middleware | `proxy.ts` (Next.js 16) | DT-33 |
| D5 | §8.15 vs §10.2 `User` | time zone as a `UserPreference` key | DT-43 |
| D6 | §14 CI/CD "contra una rama de Neon" | Neon testing DB via user secret; agents never touch it | DT-46 |
| D7 | §14 25 MB vs HU-14 10 MB | both, per context | DT-41 |
| D8 | §8.5, §9.3, §9.8, §10.2 (`Invoice.ivaRate`, `InvoiceLine`) | multi-rate invoices, `InvoiceTaxLine` | DT-44 |
| D9 | §8.11, §10.2 (`ShareLinkDocument`, `ShareEvent`), §6.5 env vars | per-document access keys, `SHARE_UNLOCK_SECRET` | DT-45 |
| D10 | §8.11 rate limiting (no store named) | Netlify rate limiting | DT-47 |
| D11 | §8.11 "PDF incrustado" | pdf.js viewer with custom toolbar | DT-50 |
| D12 | §7.1 "tres secciones" but four listed | cosmetic; the sidebar follows the four listed groups + Configuración | — |

## 9. H1-B1 wave 1 findings (rules revision requested by the user)

Context: `TASK.md` "Wave 1 problem report". Statuses as noted; OPEN items here do not block any batch
unless their row says so.

| Id | Status | Decision / finding |
|---|---|---|
| DT-53 | DECIDED (user) | **`@tanstack/react-table` stays at 9.2.8** (v9 API: `useTable`, `tableFeatures`, `createColumnHelper`, `FlexRender`). The shadcn registry data-table example uses v9; package 3.3's data-table follows that registry v9 example. Correction: an earlier Planner claim that the registry used v8 was wrong. |
| DT-54 | DECIDED | **Forms use `field`, not `form`.** shadcn 4.21.4's registry provides `field`; forms compose `field` with react-hook-form `Controller` (C8 unchanged). |
| DT-55 | DECIDED | **`cn` import source.** Registry-generated components import `cn` from the npm package `cn` (0.4.0); hand-written code imports `cn` from `@/lib/utils`. |
| DT-56 | DECIDED | **Preset `radix-vega`; `combobox` brings `@base-ui/react`.** Spec 3.4 must state which base (Radix or Base UI) `AsyncCombobox` uses. |
| DT-57 | DECIDED | **ESLint pinned at 9.39.5** for `eslint-config-next` compatibility. |
| DT-58 | **OPEN** (owner to assign) | **C1 enforcement gap.** `i18next/no-literal-string` in jsx-text-only mode does not lint attributes (`aria-label`, `placeholder`, `title`, `alt`) and skips ALL_CAPS identifiers; flat `src/components/ui/*.tsx` registry files are excluded. The Code Reviewer checks these manually. Registry English sr-only/aria strings ("Close", "Loading", etc.) need an owning package to localize them **before Hito 1 closes**; owner assigned when planning wave 5 or H1-FX. |
| DT-59 | **OPEN** | **Vitest coverage thresholds** are aggregate today; switch to `perFile` from H1-B3. |
| DT-60 | DECIDED | **Tabular numerals are global** on `body` in `globals.css`; no per-component work needed. |
| DT-61 | **OPEN** | **Next.js 16.4.0 on Netlify's runtime** is unconfirmed until the first deploy preview (Hito 2); `netlify.toml` `NODE_VERSION` is major-only `"24"`. Confirm at the first H2 deploy gate. |
| DT-62 | DECIDED | **pdf.js worker** is loaded via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`, no copy in `public/` (DT-50). Spec 3.6 must verify it under Turbopack. |
| DT-63 | DECIDED | **`chart.tsx` colors** come from theme tokens only, never from user data. |
| DT-64 | **OPEN** (non-blocking) | **pnpm ignored build scripts** for `@parcel/watcher`, `@swc/core`, `esbuild`, `unrs-resolver`. No impact so far; revisit if a tool misbehaves. |
| DT-65 | DECIDED (process) | **shadcn MCP in subagent sessions.** The MCP is available to Orca worker sessions but was not loaded in Agent-tool subagent sessions (Planner, Code Reviewer) because the root session started before `.mcp.json` existed; the user restarts the root session to fix it. Until then the Code Reviewer verifies registry usage via `pnpm exec shadcn` (DU-02 still applies). |
