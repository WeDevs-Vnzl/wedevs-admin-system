# Data rules

Sources: PRD §7.7, §8, §9, §10 (schema, complementary SQL, seed), §12, §14; DU-01 (mock layer in
Hito 1); user decisions of the batch 0 revision: OP-01 (`pg` adapter everywhere), OP-02 (CI testing
database), P2 (multi-rate invoices), P5 (portal access keys), DT-43 (time zone preference). Invariant ids
refer to `conventions.md`.

## 1. Two data layers over time

| Milestone | Source of data | Owner of the shape |
|---|---|---|
| Hito 1 | In-memory mock store under `src/mocks/` (fixtures + mock services) | `src/lib/validators/*` (Zod contracts, C8) |
| Hito 2 | PostgreSQL via Prisma 7 (`prisma/schema.prisma`) | PRD §10.2 schema **plus the approved deltas of §3a below**, mapped to the same contracts |

The contract never changes because of the swap: a Hito 2 service returns exactly the DTO the Hito 1
mock service returned. If the real schema makes a DTO field impossible, that is a contract change
(own package, sonnet) and it is reported.

## 2. Mock data (Hito 1)

- **Location.** `src/mocks/store.ts` (in-memory store), `src/mocks/fixtures/<module>.ts` (seed data),
  `src/mocks/services/<module>.ts` (mock services), `src/mocks/session.ts` (mock user and role),
  `src/mocks/ctx.ts` (mock `ctx`). Every file starts with `// MOCK`. (C5, C9)
- **Store.** A single object on `globalThis` (survives hot reload), built lazily from fixtures on first
  access, one collection per model the UI needs. `resetMockStore()` rebuilds it from fixtures (exposed
  in the user menu as a MOCK-only action).
- **Session persistence.** Mutations performed through mock actions update the store and call
  `revalidatePath`, so they are visible across pages for as long as the server process lives. With
  `next dev`/`next start` that is the whole review session. On a Netlify deploy preview the store is
  per function instance and resets on cold start; accepted for Hito 1 (DT-32); the UI shows a
  "Mock data" badge.
- **Typing.** Fixtures are typed with the DTO/input types of `src/lib/validators`. Enum values are the
  schema values. Money, rates and percentages are decimal **strings** (C8, C15).
- **Derived values are computed, not typed in.** Fixtures store the inputs (invoice lines with their
  rates and discounts, rates, allocations, movements); derived fields (line `netAmount`, per-rate tax
  lines, `subtotal`, `discount`, `exemptAmount`, `taxBase`, `ivaAmount`, `total`, `receivable`, `*Usd`,
  `paidAmount`, `balance`, `status`, `unallocated`, account balances, installment status) are computed
  when the store is built and after each mock mutation, through `src/lib/finance/*` (C17).
- **Identifiers.** Stable, readable string ids (e.g. `cli_kairos`, `inv_0042`) so fixtures can reference
  each other across modules and the optional demo seed (§9) can reuse them. Codes follow the real format
  (`CLI-0007`) through a mock sequence that mirrors §5.
- **Coherent dataset.** One fictional studio dataset spans all modules (the wireframes' fictional names
  are acceptable): clients with contacts, multi-client projects, billing plans with installments and
  recurring charges, invoices in USD and VES **with lines at 16 %, 8 %, 0 % and exempt** and withholdings,
  payments with IGTF/fees and cross-currency allocations, accounts in USD/USDT/VES with transfers and
  movements, recurring and one-off expenses, documents in all three formats with versions, share links
  (including one with a key-protected document; its mock key is documented in the fixture as MOCK),
  notes, tags, activity entries (including `SYSTEM` and `PUBLIC` actors), and alert-triggering cases
  (overdue invoice, document about to expire, pending installment, payment awaiting verification,
  missing VES rate on a business day). Volume: enough to exercise pagination (≥ 60 clients).
- **Mock services behave like the real ones.** Same name and signature (`fn(ctx, input)`), same DTOs,
  same validation outcomes: `CONFLICT` on duplicate tax id + country or invoice number, `INTEGRITY_LOCK`
  on §7.7 locks, `ACCESS_KEY_INVALID`/`ACCESS_KEY_LOCKED` in the portal, archived rows excluded unless
  asked, mock activity entries with field diffs, derived values through `lib/finance`. No network.
- **Removal.** In Hito 2, the package that swaps a module deletes `src/mocks/services/<module>.ts` and
  `src/mocks/fixtures/<module>.ts` in the same package. Cross-module aggregate mocks (dashboard, reports,
  graph, search, alerts, trash) are removed in H2-B6. H2-B7 verifies that `src/mocks/` is gone and flips
  the ESLint rule to forbid `@/mocks` everywhere.

## 3. Schema ownership (Hito 2)

- `prisma/schema.prisma` is a transcription of PRD §10.2 (Prisma 7, `prisma-client` generator with
  output `../src/generated/prisma`, URLs in `prisma.config.ts` per §10.2.1) **with exactly the deltas of
  §3a**. Any other deviation (a missing index, a renamed field, a new model) is a PRD change: the
  developer stops and reports it; the user decides.
- Only one package per wave owns `prisma/` (C21, `phase-gates.md` rule 10); always routed to sonnet.
- The generated client (`src/generated/prisma`) is gitignored and produced by `prisma generate`.
- `src/server/db/` (client, soft-delete extension, transaction helpers, sequence helper) is the only
  place that instantiates `PrismaClient`. Nothing outside `src/server/` imports Prisma (C7).
- **Adapter (OP-01, user decision):** `PrismaClient` is always created with `@prisma/adapter-pg` over
  `DATABASE_URL`, in every environment. No Neon adapter, no `@neondatabase/serverless`, no branching on
  the host name. The PRD §10.2.1 snippet that imports `PrismaNeon` is replaced by the `PrismaPg`
  equivalent (recorded drift). The pool per function instance is small (a few connections).

### 3a. Approved schema deltas vs PRD §10.2

**Δ1 — Multi-rate invoices (P2).** Each invoice line carries its own VAT rate (or is exempt); the
header totals are derived from the lines (`conventions.md` C17 formula).

- `Invoice`: **remove `ivaRate`**. `subtotal`, `discount`, `exemptAmount`, `taxBase`, `ivaAmount`,
  `total` stay, as caches derived from the lines and tax lines inside the mutation's transaction. Add the
  relation `taxLines InvoiceTaxLine[]`.
- `InvoiceLine`: add
  ```prisma
  discount  Decimal  @default(0) @db.Decimal(18, 2)
  netAmount Decimal  @db.Decimal(18, 2)          // amount − discount
  ivaRate   Decimal? @db.Decimal(5, 2)           // null = exempt; 0 = taxable at 0 % (export)
  ```
- New model:
  ```prisma
  model InvoiceTaxLine {
    id        String  @id @default(cuid())
    invoiceId String
    ivaRate   Decimal @db.Decimal(5, 2)
    taxBase   Decimal @db.Decimal(18, 2)
    ivaAmount Decimal @db.Decimal(18, 2)          // computed, adjustable ±0.01 to match the document
    invoice   Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
    @@unique([invoiceId, ivaRate])
  }
  ```
- Fiscal setting: `fiscal.ivaRates` (allowed rates, seed `["16", "8", "0"]`) and `fiscal.ivaDefaultRate`
  (`"16"`) replace the single default rate.
- Reports "IVA facturado" (§8.13.1) sum `InvoiceTaxLine.ivaAmount` grouped by rate.

**Δ2 — Portal access keys (P5).** A document inside a share link may require an access key.

- `ShareLinkDocument`: add
  ```prisma
  accessKeyHash      String?    // scrypt hash "scrypt$N$r$p$<salt>$<hash>"; null = no key required
  accessKeyUpdatedAt DateTime?
  ```
- `enum ShareEvent`: add `UNLOCK` and `UNLOCK_FAILED`.
- `ShareAccessLog`: add `@@index([shareLinkId, documentId, ipHash, createdAt])` for the attempt lockout
  (5 failures / 15 min per link, document and IP hash — C22).
- Setting or regenerating a key is logged as `UPDATE` on `SHARE_LINK` with `changes.accessKey` recorded
  only as "changed" (never the key).

**Δ3 — Time zone preference (DT-43).** No schema change: stored as `UserPreference` key `timezone`
(PRD §8.15 lists it, §10.2 `User` has no column for it).

## 4. Complementary SQL migration (PRD §10.3)

One hand-written migration, created right after the initial schema migration in H2-B1, containing the
elements of §10.3 plus the CHECKs of the approved deltas:

1. Extensions `unaccent` and `pg_trgm`.
2. Polymorphic link CHECKs: `doclink_one_target`, `notelink_one_target`, `tag_one_target`
   (`num_nonnulls(...) = 1`).
3. Partial uniques that respect soft delete: `client_taxid_country_active`, `invoice_number_active`,
   `allocation_unique_active`, `contact_one_primary`.
4. Integrity CHECKs: `rc_billing_day` (1–28), `re_day` (1–28), `tr_diff_account`, `pay_amounts`.
5. Δ1 CHECKs: `invline_discount` (`discount >= 0 AND discount <= amount`), `invline_rate`
   (`"ivaRate" IS NULL OR "ivaRate" BETWEEN 0 AND 100`), `invtax_adjust`
   (`abs("ivaAmount" - round("taxBase" * "ivaRate" / 100, 2)) <= 0.01`).
6. Search: text search configuration `es_unaccent` (copy of `simple` + `unaccent`), generated
   `tsvector` column `search` on `SearchEntry` with weights A/A/B/C, GIN indexes `search_entry_fts` and
   `search_entry_trgm`.

Prisma will report drift for the generated column and the custom indexes; the migration checklist covers
it. Service tests assert each constraint.

## 5. Sequences and codes

- `Sequence` rows `CLI`, `PRY`, `FAC`, `PAG`, `GAS`, `DOC` start at 0 (seed).
- A code is allocated **inside the creating transaction** with
  `UPDATE "Sequence" SET value = value + 1 WHERE name = $1 RETURNING value` and formatted
  `<PREFIX>-<value padded to 4>`; it is immutable. Never `MAX(code) + 1`, never outside the transaction
  (C12).
- Codes beyond 9999 keep growing (`CLI-10000`); padding is a minimum.

## 6. Soft delete (PRD §7.7)

- Entities with `deletedAt` (+ `deletedById` where the schema has it): `User`, `Client`, `Contact`,
  `Project`, `Invoice`, `PaymentAllocation`, `Payment`, `Account`, `AccountTransfer`,
  `AccountMovement`, `Expense`, `RecurringExpense`, `Document`, `Note`, `File`.
- The soft-delete Prisma extension (`src/server/db/`) adds `deletedAt: null` to reads by default. Reading
  archived rows requires an explicit `includeArchived` flag, available only to Owner/Admin paths ("Show
  archived", trash, graph toggle).
- Archive = set `deletedAt`/`deletedById` + `logActivity('DELETE')` + `SearchEntry.archived = true`, in
  one transaction. Restore = clear them + `RESTORE` + reindex. No purge in the MVP.
- Partial unique indexes apply only to non-archived rows, so restoring may hit a conflict; restore
  returns `CONFLICT` in that case.
- Integrity locks and cascades: C19. Voiding (`ANULADA`, `ANULADO`) is a status, not a delete.
- `ActivityLog`, `ShareAccessLog`, `DocumentVersion`, `ExchangeRate`, `InvoiceTaxLine` are never
  soft-deleted (tax lines are rebuilt with their invoice).

## 7. Search index (PRD §7.6, §10.2 `SearchEntry`)

- One `SearchEntry` per searchable entity (client, contact, project, invoice, payment, expense,
  account, document, note), unique on `(entityType, entityId)`.
- Maintained by `reindexEntity(type, id)` called by the service inside the mutation's transaction
  (C12): `code`, `title`, `subtitle`, `body` (plain text), `status`, `archived`.
- `searchGlobal(q, filters)` combines the `tsvector` match (`es_unaccent`) with trigram similarity on
  `title`; prefix filters `c:`, `p:`, `f:`, `d:`, `n:`; an exact code match ranks first (HU-26 CA3).
  Target p95 < 200 ms.
- Hito 1: the mock search service implements the same signature over the mock store with accent-folding
  and a simple fuzzy match.

## 8. Money columns and rules

- `Decimal(18,2)` amounts, `Decimal(20,8)` rates, `Decimal(5,2)` percentages and VAT rates,
  `Decimal(12,2)` line quantity. `ROUND_HALF_UP` to 2 decimals on persist.
- Cached aggregates (`InvoiceLine.netAmount`, `InvoiceTaxLine.*`, `Invoice.subtotal|discount|
  exemptAmount|taxBase|ivaAmount|total|receivable|totalUsd|receivableUsd|paidAmount|balance|status`,
  `Payment.unallocated`, `BillingInstallment.status`) are recomputed in the same transaction as any
  mutation that affects them (C18), and by the daily job for overdue detection. A manual ±0.01
  adjustment of a tax line's `ivaAmount` is preserved on recompute while its `taxBase` and rate are
  unchanged; it is reset when they change. `scripts/recompute-all.ts` (H2-B6) recomputes caches for
  audit, on demand, local DB only for agents.
- `ExchangeRate` unique on `(date, currency, source)`; rate prefill follows §9.2. Rate warning when the
  entered rate differs > 10 % from the last registered one (PRD §15).

## 9. Seeds

- `prisma/seed.ts` (H2-B1) seeds **only** catalogs and settings (§10.4): currencies (USD, VES, EUR,
  USDT, COP), payment methods, document categories and types (§8.9.1), expense categories (§8.8),
  ~60 technologies, fiscal settings (`ivaRates` `["16","8","0"]`, default 16, IGTF 3, invoice due days
  15), sequences at 0. Idempotent (upserts). Safe for production: no business data.
- `prisma/seed-demo.ts` (optional, H2-B1): loads the Hito 1 MOCK fixtures into a database so real
  modules show the same coherent dataset during the mixed period (DT-35). It refuses any non-localhost
  host when run by an agent (`safeguards.md` rule 8) and is never run against production. Sequences are
  set to the max code loaded. Whether the user runs it against a preview branch is the user's decision.
- Seeds never contain real customer data (C5).

## 10. Migration checklist (every package that owns `prisma/`)

1. The change is in `prisma/` only, and this package is the only `prisma/` owner of the wave.
2. `prisma migrate dev --name <descriptive_name>` against the worker's **own** podman Postgres
   (`DATABASE_URL=postgresql://postgres:dev@localhost:<port>/core`, same `DIRECT_URL`).
3. Never edit a migration that is already on `main`; a fix is a new migration (C21).
4. Hand-written SQL lives in its own migration folder with a descriptive name and is idempotent where
   possible (`IF NOT EXISTS`).
5. `prisma migrate reset --force` on the worker's container applies the full history from zero without
   errors, then `prisma db seed` succeeds.
6. `prisma validate` and `prisma generate` succeed; `tsc --noEmit` passes.
7. Tests cover every CHECK/partial-unique introduced.
8. The package report lists the new migration folders and confirms the schema equals PRD §10.2 + §3a.
   The container is removed at the end (`safeguards.md` rule 2).
9. No agent runs `prisma migrate deploy`, `db push`, a reset or a seed against a non-local database —
   including the Neon testing database used by CI (OP-02). Applying migrations there and to
   preview/production happens in pipelines owned and configured by the user.

### 10a. Enum parity check

From H2-B1, a unit test asserts that every enum in `src/lib/validators/enums.ts` equals the generated
Prisma enum value by value (including the Δ2 `ShareEvent` additions).

## 11. Dates and time zone

- `@db.Date` for business dates; `DateTime` (UTC) for timestamps.
- "Today" for status rules (overdue invoices, document expiry, alerts, recurring generation) is the date
  in `America/Caracas`, computed from `ctx.now` through `src/lib/dates.ts`.
- The user's display time zone is the `UserPreference` key `timezone` (default `America/Caracas`,
  DT-43); it affects display only, never business rules.
- The daily job runs at 10:00 UTC (06:00 VET) (§12).

## 12. Retention

- `ActivityLog`: kept indefinitely (proposal; P6 open).
- `ShareAccessLog`: proposal 24 months (P6 open). No deletion job is built until P6 is decided.
