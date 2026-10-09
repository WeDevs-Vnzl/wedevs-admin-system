# Conventions and non-negotiable invariants

Sources: PRD §4.3, §6.3, §6.4, §7.7, §7.8, §9, §12, §14; user decisions DU-01, DU-02 and the batch 0
revision (P2 multi-rate invoices, P5 portal access keys, OP-01…OP-06, DT-31…DT-43 — see
`decisions.md`). If this file and the PRD disagree, the PRD wins **except** where `decisions.md`
records a user decision that amends the PRD.

Part A lists the **numbered invariants** (`C1`…`C26`). The Code Reviewer treats every violation of an
invariant whose milestone tag is active as **BLOCKING**. Part B lists general conventions (non-blocking
unless they break an invariant or a PRD acceptance criterion).

## Milestone tags

Delivery follows DU-01: **Hito 1** = complete UI over a mock layer; **Hito 2** = real implementation
that replaces the mocks block by block. Each invariant carries one tag:

- **[H1]** — enforceable from the first Hito 1 batch. BLOCKING in every batch.
- **[H1-shape]** — from Hito 1 the code must already have the *shape* the invariant requires (so Hito 2
  does not rewrite UI); the full guarantee becomes BLOCKING when the module is swapped to real code in
  Hito 2.
- **[H2]** — enforceable when the module's real implementation lands in Hito 2. In Hito 1 the
  reviewer checks that nothing in the UI makes it impossible later, but does not block on it.

---

## Part A — Numbered invariants

### UI, content and repository hygiene

**C1 [H1] — No hardcoded user-facing strings.** Every visible string (labels, buttons, placeholders,
toasts, empty states, `aria-label`, `title`, page metadata, Zod error messages shown to users, CSV
headers) comes from `src/i18n/messages/{es,en}/<namespace>.json` through `next-intl`. Data entered by
users is not translated. Enum labels come from the `enums` namespace. (PRD §7.8, §14.)

**C2 [H1] — ES/EN key parity.** Every key exists in both `es` and `en`. `pnpm i18n:check` (script
`scripts/check-i18n.ts`) fails on any missing or extra key and runs in CI. Catalogs store `name` (ES)
and optional `nameEn`; the UI falls back to `name`. (PRD §7.8, §14.)

**C3 [H1] — shadcn MCP mandatory; registry components only through the pinned CLI (DU-02).** Every
agent doing UI work consults the shadcn MCP (`mcp__shadcn`) before adding or composing shadcn
components. Components are installed with `pnpm exec shadcn add …` (exact-pinned devDependency),
never copied by hand from the website or another repo, and a component the registry provides is never
hand-written. Generated files under `src/components/ui/` are only modified for theming or i18n, and the
modification is noted in the package report. Shared kit components (data-table, `MoneyInput`,
`RateInput`, combobox, uploader, PDF viewer) are compositions of registry components, not
re-implementations of them. The Code Reviewer verifies it.

**C4 [H1] — Markdown and rich text are sanitized on render.** Markdown renders only through the shared
`MarkdownView` (`react-markdown` + `remark-gfm` + `rehype-sanitize`, no `rehype-raw`). Tiptap content
renders through Tiptap's renderer with the project's extension allowlist; pasted HTML is normalized by
the schema. `dangerouslySetInnerHTML` is forbidden outside a reviewed sanitizer wrapper. Scripts,
iframes, `on*` handlers and `javascript:` URLs never reach the DOM — in the editor preview, the
portal, notes and print views alike. (PRD §6.2, §14, HU-18 CA4.)

**C5 [H1] — No secrets, no real data.** No credential, token, key, real connection string or real
customer data in code, fixtures, tests, logs, screenshots or commits. Only `.env.example` with
placeholders is committed. Mock data is fictitious and every mock file starts with a `// MOCK` header
comment. Agents never read, print or copy `.env.local` or any CI secret (`phase-gates.md` rule 11).
Credentials documents store only a link to a password manager (PRD §8.9.1). Account identifiers are
always shown and stored masked (PRD §8.7, §14). Portal access keys are never stored or logged in clear
(C22).

**C6 [H1] — No Claude attribution.** No `Co-Authored-By: Claude`, "Generated with Claude Code" or
similar in any commit, PR or file (`phase-gates.md` rule 12).

### Layering and contracts

**C7 [H1] — Components never touch a data source.** Pages, layouts and components under
`src/app/**`, `src/components/**` and `src/features/*/components/**` read only through
`src/features/<module>/queries.ts` and mutate only through `src/features/<module>/actions.ts`. They
never import Prisma or `@/generated/prisma` (Hito 2) nor anything under `@/mocks` (Hito 1). Enforced by
ESLint `no-restricted-imports`. (PRD §6.4 rule 4.)

**C8 [H1] — Zod validators are the contract.** `src/lib/validators/<module>.ts` holds the input schemas
and the DTO types for every module. Mock data, mock services, queries, actions, forms and (in Hito 2)
real services all use these types; nothing redefines a DTO locally. DTOs expose money, rates and
percentages as **decimal strings** (PRD §9.1). Enums in `src/lib/validators/enums.ts` mirror the
Prisma enums of the schema (PRD §10.2 + the approved deltas in `data-rules.md` §3a) value by value. A
change to a validator consumed by more than one module is its own package, routed to sonnet. (PRD §6.4
rule 3.)

**C9 [H1] — Mock isolation (DU-01).** All mock code lives under `src/mocks/` (store, fixtures, mock
services, mock session) and starts with `// MOCK`. Only these files may import `@/mocks/**`:
`src/features/*/queries.ts`, `src/features/*/actions.ts`, `src/server/context.ts`,
`src/server/auth/session.ts`, files inside `src/mocks/`, and tests. Mock services export the **same
function names and signatures** as the future PRD §12 services (`fn(ctx, input) → DTO`), so Hito 2
swaps an import, not the UI. A module is "swapped" when its queries/actions import
`@/server/services/<module>.service` and its files under `src/mocks/` are deleted in the same package.
At the close of Hito 2, `src/mocks/` does not exist and the ESLint rule forbids `@/mocks` everywhere.

**C10 [H1-shape] — Every Server Action is an adapter with a fixed sequence:** resolve the session
user → `can(user, action, resource)` → Zod parse → call the service → `revalidatePath`/`revalidateTag`
→ return `ActionResult<T>`. Actions are built only with `defineAction`
(`src/server/actions/define-action.ts`), which enforces the order. **Single exception — the public
portal:** portal actions (e.g. unlocking a document with its access key, P5) are built only with
`definePublicAction` (`src/server/actions/define-public-action.ts`), whose fixed sequence is: resolve
the share token (generic 404 on failure) → Zod parse → service → `ActionResult`; it never reads a
session and never grants more than the token's own documents. In Hito 1 the session, token resolution
and services are mocks, but the sequences are real. Every read action (async combobox, search) follows
the same sequence. `ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code; message;
fieldErrors? } }`. (PRD §4.3, §6.4 rule 1, §12, §14.)

**C11 [H1-shape] — Services are framework-free and receive `ctx`.** Files under
`src/server/services/` (Hito 2) and `src/mocks/services/` (Hito 1) import nothing from `next/*`,
`react`, `next-intl` or `@clerk/*`; they receive `ctx = { db, user, now }` (built only by
`src/server/context.ts`; for public portal services `user` is `null` and the share link is passed as
input) and return typed DTOs from `src/lib/validators`. `now` is the only clock (no `new Date()`
inside services). No provider-specific database code (OP-01). (PRD §6.4 rule 2.)

**C12 [H2] — Side effects live in the service, inside the same transaction.** Activity log
(`logActivity`), search index (`reindexEntity`), balance/status recomputation and sequence codes are
executed by the service in the same Prisma transaction as the mutation. No generic middleware, no
fire-and-forget after commit. (PRD §6.4 rule 5, §8.14.) In Hito 1, mock services append mock activity
entries so the UI shows them, but this is not a guarantee.

**C13 [H2] — Authorization is server-side and the DB role is the source of truth.** `can()`
(`src/server/auth/permissions.ts`, matrix of PRD §4.3) is evaluated in every action and route handler
against the role stored in the local `User` table, never against Clerk `publicMetadata` or a client
value. Hiding a button is cosmetic. A Member calling a financial action gets `FORBIDDEN` and nothing
changes (HU-02 CA2). Members may delete only their own notes. (PRD §4.2, §4.3.)

**C14 [H2] — Never trust a client-supplied id.** Every id received by an action or route is resolved
by the service, which checks existence and soft-delete state (and ownership where §4.3 requires it)
before using it. (PRD §14.)

### Money (PRD §9, amended by P2)

**C15 [H1] — Money is never a float.** Amounts, rates and percentages are computed only with
`decimal.js` through `src/lib/money.ts`, `src/lib/rates.ts` and `src/lib/finance/*`; stored as Prisma
`Decimal` (`Decimal(18,2)` amounts, `Decimal(20,8)` rates, `Decimal(5,2)` percentages); exposed as
strings in DTOs. Forbidden on money anywhere (UI live totals, mock services, fixtures, services,
reports, CSV): `number` arithmetic, `parseFloat`, `Number(...)`, `toFixed` for math, `Math.round`.
Rounding is `ROUND_HALF_UP` to 2 decimals on persist. Display formatting uses `Intl.NumberFormat` over
the string via `formatMoney`. Applies from Hito 1 (user-approved). (PRD §6.2, §9.1.)

**C16 [H1-shape] — USD snapshots are stored, never recomputed.** `amountUsd`, `totalUsd`,
`receivableUsd` and allocation `amountUsd` are computed once at write time with the transaction's own
`usdRate` (`amountUsd = round(amount / usdRate, 2)`). Changing `ExchangeRate` never touches existing
transactions. The only recomputation allowed is an explicit edit of that transaction's own rate (or, for
an invoice, of its lines), which is logged and recomputes the dependent aggregates (§9.2). Reports and
KPIs sum snapshots; they never convert historical amounts with today's rate (except "account balance in
USD with the latest rate", §8.1). Mock services follow the same rule. (PRD §5, §9.2.)

**C17 [H1-shape] — Financial formulas are implemented once, in `src/lib/finance/`.** Pure functions
with ≥ 90 % coverage for: invoice totals with **multiple VAT rates per invoice** (formula below, user
decision P2, replaces PRD §9.3), invoice status (§9.4, `VENCIDA` wins over partial payment),
cross-currency allocation (§9.5, settled when balance ≤ 0.01), IGTF and fees (§9.6, IGTF is not income,
fees are not duplicated as expenses), account balance (§9.7, `accountAmount` when currencies differ),
installment status and template splits (§8.4.2), recurring normalization to month (§8.13.2). Mock
services (H1), real services (H2) and live form totals all call them; nobody re-derives a formula inline.

Invoice totals (P2):

```
per line:   amount     = round(quantity × unitPrice, 2)
            discount   = line discount (0 ≤ discount ≤ amount)
            net        = amount − discount
            ivaRate    = the line's VAT rate (e.g. 16, 8, 0) or EXEMPT (ivaRate null)
header:     subtotal      = Σ amount
            discount      = Σ line discount
            exemptAmount  = Σ net of EXEMPT lines
            for each distinct rate r of non-exempt lines (0 % included, it is taxable at 0):
              taxBase[r]  = Σ net of lines with rate r
              ivaAmount[r]= round(taxBase[r] × r / 100, 2)   (editable ±0.01 per rate)
            taxBase       = Σ taxBase[r]
            ivaAmount     = Σ ivaAmount[r]
            total         = taxBase + exemptAmount + ivaAmount
            withholdings  = ivaWithheld + islrWithheld + otherWithheld
            receivable    = total − withholdings
            totalUsd      = round(total / usdRate, 2);  receivableUsd = round(receivable / usdRate, 2)
            paidAmount, balance: unchanged from §9.3
```

**C18 [H2] — Money mutations are atomic and serialized.** Any mutation of invoices (incl. lines and
per-rate tax lines), payments, allocations, accounts, transfers, movements, expenses, installments or
recurring charges, together with the aggregates it affects (`paidAmount`, `balance`, `status`,
`unallocated`, installment status, account balance), runs in one `Serializable` transaction or under
`SELECT … FOR UPDATE` on the invoice and payment rows. Validation rules of §8.6 are checked inside that
transaction. (PRD §14.)

### Data lifecycle

**C19 [H1-shape] — Soft delete by default, integrity locks enforced.** Main entities are archived
(`deletedAt`, `deletedById`), never hard-deleted; there is no purge in the MVP. Default reads exclude
archived rows; "Show archived" (Owner/Admin) and the trash opt in explicitly. Locks (§7.7): an invoice
with allocations cannot be archived (it is voided); archiving a client with active projects or invoices
needs explicit confirmation and archives its contacts; an account with movements cannot be archived,
only deactivated; a technology or document type in use cannot be deleted, only deactivated; a billed
installment cannot change amount or currency; a `FIRMADO` document accepts no new version. Hito 1
builds the dialogs and the mock services refuse locked operations with `INTEGRITY_LOCK`; Hito 2
enforces them in the service. (PRD §7.7, §8.3, §8.4.2, §8.9.3, HU-06, HU-21.)

**C20 [H2] — The activity log is append-only.** There is no update or delete service for
`ActivityLog`; diffs exclude sensitive fields and long texts (only "changed" is recorded). Portal
accesses (views, downloads, unlock attempts) go to `ShareAccessLog` with the IP stored only as a salted
SHA-256 hash. (PRD §8.14, §8.11.)

**C21 [H2] — Schema changes only in `prisma/`; migrations on `main` are never edited.** See
`data-rules.md`. No agent migrates, seeds or queries a non-local database (`phase-gates.md` rule 9).

### Security surfaces

**C22 [H1-shape] — Portal security.** `/s/[token]` and `/api/s/[token]/files/[documentId]` are public
by token (DT-42): tokens are 32 random bytes from a CSPRNG in base64url (43 chars); an unknown, revoked
or expired token renders the same generic "Link not available" page with status **404** and no reason;
responses carry `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`,
`Cache-Control: private, no-store`; Netlify rate limiting on `/s/*` and `/api/s/*` (60 req/min per IP,
OP-03); only the documents (and pinned versions) of the link are reachable; no listing; no internal
data shown. **Access keys (P5):** a document inside a share link may require an access key. The key is
stored only as a `scrypt` hash with per-key salt, shown in clear once at creation/regeneration, never
logged; the visitor must enter it before viewing **or** downloading that document; comparison is
constant-time; failed attempts are logged (`UNLOCK_FAILED`) and after 5 failures per link, document and
IP hash within 15 minutes further attempts are refused for 15 minutes; success sets an httpOnly,
`Secure`, `SameSite=Strict` cookie scoped to `/s/<token>` and `/api/s/<token>`, signed with
`SHARE_UNLOCK_SECRET`, listing the unlocked document ids and expiring with the session (max 12 h); the
download route checks it. Hito 1 builds the UI (locked cards, unlock dialog, error and lockout states,
generic 404) over mock links; Hito 2 implements tokens, hashing, headers, rate limits and logging.
(PRD §8.11, §14, HU-22.)

**C23 [H1-shape] — File security.** Private bucket; uploads and downloads only through presigned URLs
with a 5-minute TTL generated per click; MIME validated by magic bytes at confirm; allowlist PDF,
images, DOCX, XLSX, PPTX, MD, TXT, ZIP; max **25 MB** in general; **payment receipts** PDF/PNG/JPG/WEBP
up to **10 MB** (HU-14, DT-41). `File` rows stay `PENDING` until confirmed. In Hito 1 the uploader
enforces allowlist and size client-side through the `UploadAdapter` interface (mock adapter); Hito 2
adds the server checks. (PRD §6.2, §14.)

**C24 [H2] — Auth surfaces and headers.** Clerk runs in **`proxy.ts`** (Next.js 16) and protects every
route except `/sign-in`, `/s/[token]`, `/api/s/*` and `/api/webhooks/*`; the Clerk webhook verifies the
Svix signature before doing anything; registration is invitation/allowlist only. Strict CSP (Clerk and
bucket domains allowlisted; `worker-src 'self'` for the pdf.js and graph workers), HSTS,
`X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`. (PRD §4.2, §14.)

### Delivery gates

**C25 [H1] — Shared files have one owner per wave.** A package only touches the files listed for it in
`TASK.md`. Root `package.json`/lockfile, `prisma/`, the i18n namespace index, `(app)` layout, sidebar,
topbar, `proxy.ts`, `src/server/context.ts`, `src/server/actions/define-action.ts`,
`src/server/actions/define-public-action.ts` and validators consumed by several modules are changed only
by their declared owner (`phase-gates.md` rule 10).

**C26 [H2] — Each Hito 2 block is verified on a deploy preview before the next one opens.** No agent
deploys, pushes without approval, merges to `main`, or touches Netlify, Neon (including the CI testing
database), Clerk, the bucket, DNS, Sentry or secrets. See `TASK.md` § "Hito 2 deploy gate".
(`phase-gates.md` rules 5, 9, 11.)

### Quick reference: invariant × milestone

| Id | Topic | Tag |
|---|---|---|
| C1 | No hardcoded strings | H1 |
| C2 | ES/EN parity | H1 |
| C3 | shadcn MCP + pinned CLI (DU-02) | H1 |
| C4 | Sanitized markdown / rich text | H1 |
| C5 | No secrets, mock marked MOCK | H1 |
| C6 | No Claude attribution | H1 |
| C7 | Components never touch data source | H1 |
| C8 | Zod validators are the contract | H1 |
| C9 | Mock isolation | H1 |
| C10 | Action sequence via `defineAction` / `definePublicAction` | H1-shape |
| C11 | Framework-free services with `ctx` | H1-shape |
| C12 | Side effects in the service transaction | H2 |
| C13 | Server-side authorization, DB role | H2 |
| C14 | Never trust client ids | H2 |
| C15 | Money never float | H1 |
| C16 | USD snapshots never recomputed | H1-shape |
| C17 | Financial formulas in `lib/finance` (multi-rate invoices) | H1-shape |
| C18 | Serializable money mutations | H2 |
| C19 | Soft delete + integrity locks | H1-shape |
| C20 | Append-only activity log | H2 |
| C21 | Schema only in `prisma/` | H2 |
| C22 | Portal security incl. access keys | H1-shape |
| C23 | File security | H1-shape |
| C24 | Auth surfaces (`proxy.ts`) and headers | H2 |
| C25 | One owner per shared file per wave | H1 |
| C26 | Deploy-preview gate per Hito 2 block | H2 |

---

## Part B — General conventions

### Language and naming

- Code, identifiers, comments, commits, test names and agent reports in English. User-facing text only
  in the i18n files.
- Domain enum **values** stay as in the PRD schema (Spanish, e.g. `EN_CURSO`, `PENDIENTE_VERIFICACION`);
  everything else is English. Do not translate enum values in code.
- Files: `kebab-case.ts(x)`. Components: `PascalCase`. Services: `<module>.service.ts`. Validators:
  `src/lib/validators/<module>.ts`. Mock services: `src/mocks/services/<module>.ts`. Tests next to the
  code (`*.test.ts`) or under `tests/` for E2E (`tests/e2e/*.spec.ts`).
- Service function names are exactly those of PRD §12 (`createClient`, `allocatePayment`, …) plus the
  portal additions (`unlockSharedDocument`, `setShareDocumentAccessKey`). Query and action wrappers reuse
  the service name (`createClientAction` for the action).
- Entity codes: `CLI-0001`, `PRY-`, `FAC-`, `PAG-`, `GAS-`, `DOC-` (4-digit pad, immutable).

### Folder layout (PRD §6.3)

```
src/
  proxy.ts                          # Hito 2 (Clerk, headers) — Next.js 16 naming
  app/(auth)/sign-in/[[...sign-in]]/page.tsx
  app/(app)/<module>/...            # routes of PRD §11
  app/s/[token]/                    # public portal (outside (app))
  app/api/...                       # Hito 2: webhooks, downloads
  features/<module>/components/     # module UI
  features/<module>/queries.ts      # reads for RSC (seam to services)
  features/<module>/actions.ts      # "use server" actions built with defineAction / definePublicAction
  server/context.ts                 # builds ctx = { db, user, now }
  server/actions/define-action.ts   # the action adapter (C10)
  server/actions/define-public-action.ts  # portal-only adapter (C10 exception)
  server/auth/                      # permissions.ts (can), session.ts, types.ts; Clerk in Hito 2
  server/services/                  # Hito 2 domain services
  server/{db,activity,storage,search,jobs}/   # Hito 2
  lib/validators/                   # Zod contracts (C8)
  lib/money.ts lib/rates.ts lib/dates.ts lib/utils.ts
  lib/finance/                      # pure financial calculators (C17)
  components/ui/                    # shadcn registry components + shared kit
  components/patterns/              # page/overview/detail/form building blocks
  components/app/                   # shell: sidebar, topbar, command menu, footer
  i18n/                             # next-intl config + messages/{es,en}/<namespace>.json
  mocks/                            # Hito 1 only (C9)
netlify/functions/                  # Hito 2
prisma/                             # Hito 2
tests/e2e/                          # Playwright
scripts/                            # i18n check, recompute-all (Hito 2)
```

`src/lib/finance/`, `src/components/patterns/` and `src/components/app/` are additions to the PRD §6.3
tree (DT-34, DT-36).

### TypeScript and React

- `strict` on; no `any` (use `unknown` + Zod); no non-null `!` on external data.
- Server Components by default; `"use client"` only for interactivity (forms, table state, graph,
  editors, PDF viewer, command menu). Data fetching happens in RSC through `queries.ts`; client components
  receive DTOs as props or call read actions.
- Everything under `src/server/` imports `server-only`.
- URL state (filters, sort, page, page size, `?tab=`) through `nuqs`.
- Forms: react-hook-form + `zodResolver` with the same schema the action parses (PRD §7.4).

### Errors and results

- Actions never throw to the client; they return `ActionResult`. Error codes (in
  `src/lib/validators/common.ts`): `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`,
  `CONFLICT` (e.g. duplicate tax id / invoice number), `INTEGRITY_LOCK` (§7.7 locks),
  `ACCESS_KEY_INVALID`, `ACCESS_KEY_LOCKED` (portal, P5), `INTERNAL`. `message` is an i18n key, not prose.
- Duplicate warnings that do not block (possible duplicate payment, tax id in use with link to the
  existing record) are returned as data (`warnings[]`), not as errors.

### Dates

- Stored in UTC; business dates are date-only (`@db.Date`, `YYYY-MM-DD` strings in DTOs).
- Display and "today" are computed in `America/Caracas` through `src/lib/dates.ts`; never use the
  server's local zone. The per-user display time zone is a `UserPreference` key (DT-43), default
  `America/Caracas`; business "today" for statuses and jobs is always `America/Caracas`.

### Tests

- Vitest for pure functions, validators, `can()`, mock services and (Hito 2) services. Runners run once
  (`vitest run`), never watch mode.
- Coverage ≥ 90 % on `src/lib/money.ts`, `src/lib/rates.ts`, `src/lib/finance/**` (from Hito 1) and on
  the invoice, payment, account and billing services (Hito 2). (PRD §14.)
- Playwright E2E per user story under `tests/e2e/`, assigned in `TASK.md`. Critical stories: HU 03, 09,
  11, 13, 18, 22, 24 (PRD §14). Agents run E2E **only locally** (`next start` with mocks in Hito 1; local
  podman Postgres in Hito 2). CI runs the same suite against the user's Neon testing database (OP-02).

### Commits and branches

- Conventional commits in English (`feat(clients): …`, `fix(money): …`). No Claude attribution (C6).
- Batch base branches: `batch/<scope>-<topic>` (e.g. `batch/h1-b1-ui-foundations`,
  `batch/h2-b4-finance`, `batch/fix-<topic>`).

### Accessibility and responsive (PRD §14)

- WCAG 2.1 AA: full keyboard navigation (the graph offers an alternative node list), visible focus,
  labelled controls, sufficient contrast in both themes.
- Desktop first, fully usable on tablet; on mobile the dashboard, details, payment and expense forms,
  notes and the portal are usable, the graph is viewable.
