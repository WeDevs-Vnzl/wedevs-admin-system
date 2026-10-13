# Coverage matrix — fixed MVP scope

**Read-only after batch 0.** It changes only if the user changes the MVP scope (PRD §3.1). The delivery
order follows DU-01 (`decisions.md`): every capability has a **Hito 1 UI batch** (screens over mocks)
and a **Hito 2 implementation block** (real logic, verified on a deploy preview). The "PRD phase" column
keeps the original PRD §16 phase (F0–F5) for traceability. User amendments to capabilities (DT-44
multi-rate invoices, DT-45 portal access keys) are part of the same capabilities, not new scope items.

## Batch and block legend

| Id | Name | Content (summary) |
|---|---|---|
| H1-B1 | UI foundations | Scaffold + all Hito 1 deps (incl. pdf.js), shadcn kit (data-table, MoneyInput, RateInput, combobox, uploader, date field, PdfViewer), patterns, shell (sidebar, topbar, Cmd+K dialog, footer), sign-in mock (no counters), i18n + theme, preferences (incl. time zone), all Zod contracts (incl. multi-rate invoices and access keys), `can()` matrix, `lib/money|rates|dates`, mock-layer foundation, `defineAction` + `definePublicAction`, CI (no DB) |
| H1-B2 | Commercial core UI | Cross-entity tabs (notes feed + Tiptap, documents tab + attach sheet, activity timeline), tags, alert list + mock alert rules; clients + contacts; projects (links, stack, multi-client, transitions); notes module; technologies and tags settings; `/activity` |
| H1-B3 | Finance UI | `lib/finance` calculators (multi-rate invoice totals); currencies, rates, fiscal (allowed VAT rates), payment methods, expense categories settings; accounts; billing plan editor; invoices (line grid with per-line VAT rate, per-rate totals); payments + allocations; expenses + recurring |
| H1-B4 | Documents and portal UI | Document categories/types settings; documents; markdown editor; share links (incl. per-document access key toggle, generate/regenerate); public portal `/s/[token]` with mock links (brand = wireframes, pdf.js viewer, unlock dialog, lockout state); print view |
| H1-B5 | Intelligence UI | Dashboard; entity graph + global graph; reports + KPIs; Cmd+K results; alerts bell panel; trash; company and users settings |
| H1-FX | Fix/change cycle | Change batches from user feedback until the user accepts the UI |
| H2-B1 | Data foundation | Prisma schema (§10.2 + approved deltas Δ1, Δ2), complementary SQL (§10.3 + delta CHECKs), seed (§10.4 + `ivaRates`), optional demo seed, `src/server/db` (`@prisma/adapter-pg` everywhere, soft-delete extension, tx + sequence helpers), CI: service tests on a Postgres service container + E2E job on the user's Neon testing DB secret, `netlify.toml` build |
| H2-B2 | Identity and platform | Clerk (`proxy.ts`, sign-in, webhook + Svix, LOGIN), real session/context, `can()` enforcement, `logActivity`, search index writer, `StorageProvider` + presigned uploads/downloads + MIME checks, preferences/table columns/time zone/alert dismissals persistence, company settings, users and roles, security headers baseline |
| H2-B3 | Commercial core real | Services + swap for clients, contacts, projects, links, technologies, tags, notes (+ attachments), activity listing, restore for these entities |
| H2-B4 | Finance real | Services + swap for finance catalogs, rates, accounts, transfers, movements, reconciliation, billing, installments, recurring charges, invoices (multi-rate lines + tax lines), payments, allocations, expenses, recurring expenses; job step logic for overdue invoices and recurring generation |
| H2-B5 | Documents and portal real | Services + swap for document types, documents, versions, drafts, links, share links, portal token resolution, access keys (scrypt, lockout, unlock cookie), Netlify rate limiting, access log, portal downloads, portal headers; job step logic for document expiry |
| H2-B6 | Intelligence and jobs real | Graph services (+ cache tag), `searchGlobal`, dashboard/overview aggregates, reports and KPIs (IVA per rate), live alerts, server CSV export, trash listing, Netlify scheduled functions (`daily-maintenance`, `cleanup-files`), `recompute-all`; removal of aggregate mocks |
| H2-B7 | Hardening and launch | E2E of critical HUs (locally by agents, in CI on the Neon testing DB, on the preview by the user), security audit (headers/CSP, authorization, portal and access keys), performance, accessibility, Sentry, data migration (P7), operations docs, domain (DT-52), mock removal verification |

## 1. PRD §3.1 capabilities (items 1–19)

| # | Capability (PRD §3.1) | PRD refs / decisions | PRD phase | Hito 1 UI batch | Hito 2 block |
|---|---|---|---|---|---|
| 1 | Clerk authentication (invitation only) and roles ready to grow | §4, §11, HU-01, HU-02; DT-33, DT-40, DT-48 | F0 | H1-B1 (sign-in screen mock, mock session, `can()` matrix, role-aware UI, "View as role") · H1-B5 (`/settings/users`) | H2-B2 |
| 2 | Clients (person or company) and contacts | §8.2, HU-03, HU-04 | F1 | H1-B2 | H2-B3 |
| 3 | Projects: N:M clients, groupable links, stack from catalog, billing plan | §8.3, §8.4, HU-05–HU-10 | F1 (projects) · F2 (billing) | H1-B2 (projects, links, stack, clients, transitions) · H1-B3 (billing plan editor, installments, recurring charges, Cobro tab) | H2-B3 (projects) · H2-B4 (billing, recurring generation) |
| 4 | Registered invoices with attached PDF, multi-project, multi-currency, IVA (**multiple rates per invoice, per line**) and withholdings | §8.5, §9.3, §9.4, HU-11, HU-12; DT-44, DT-50 | F2 | H1-B3 (line grid with per-line rate, per-rate totals, PDF viewer tab) | H2-B4 (+ H2-B2 storage for the PDF) |
| 5 | Payments with N:M allocation, receipt, IGTF and fees | §8.6, §9.5, §9.6, HU-13, HU-14; DT-41 | F2 | H1-B3 | H2-B4 (+ H2-B2 storage for receipts) |
| 6 | Company accounts, transfers between accounts and partner movements | §8.7, §9.7, HU-15, HU-16 | F2 | H1-B3 | H2-B4 |
| 7 | Operating expenses, one-off and recurring, chargeable to projects | §8.8, HU-17 | F2 | H1-B3 | H2-B4 (+ H2-B6 scheduled function wiring) |
| 8 | Documents: configurable categories/types, three formats, versioning, statuses, signature, expiry and alerts, multi-entity links | §8.9, HU-18–HU-21 | F3 | H1-B2 (`EntityDocumentsTab` + attach sheet) · H1-B4 (module, editor, versions, types) | H2-B5 (+ H2-B6 expiry job wiring) |
| 9 | Notes with rich text, author, date, tags and attachments, linkable to any entity | §8.10, HU-23 | F1 | H1-B2 | H2-B3 (+ H2-B2 storage for attachments) |
| 10 | Public document portal accessible only by exact link (**with optional per-document access key**) | §8.11, HU-22; DT-42, DT-45, DT-47, DT-50, DT-51 | F3 | H1-B4 | H2-B5 |
| 11 | Graph view per record (expandable) and global graph | §8.12, HU-24, HU-25 | F4 | H1-B5 | H2-B6 |
| 12 | General dashboard, per-module overview, reports and KPIs | §8.1, §8.13, HU-31 | F4 | H1-B5 (dashboard, reports, KPIs) · module overviews in H1-B2, H1-B3, H1-B4 | H2-B6 (dashboard, reports, KPIs) · overview queries swapped with their module in H2-B3/B4/B5 |
| 13 | Global search (Cmd+K) and cross-cutting tags | §7.5, §7.6, HU-26 | F4 (search) · F1 (tags) | H1-B1 (Cmd+K dialog, navigation, quick actions) · H1-B2 (tags) · H1-B5 (search results) | H2-B2 (index writer) · H2-B3 (tags) · H2-B6 (`searchGlobal`) |
| 14 | Tables with filters, sorting, pagination, configurable columns and CSV export | §7.3, HU-27 | F0 (kit) · F4 (CSV) | H1-B1 (data-table kit; every list consumes it) | H2-B2 (column preferences) · H2-B6 (server CSV export ≤ 10k rows, BOM, `EXPORT` activity) |
| 15 | Complete activity log | §8.14, HU-29 | F1 | H1-B2 (`/activity`, `EntityActivityTab`) | H2-B2 (`logActivity`) · H2-B3 (`listActivity`, swap) |
| 16 | Soft delete with trash and restore | §7.7, HU-28 | F1 | Archive/void/restore dialogs in each module batch (H1-B2–B4) · H1-B5 (`/settings/trash`) | H2-B1 (soft-delete extension, partial uniques) · per-module restore in H2-B3/B4/B5 · H2-B6 (trash listing) |
| 17 | Spanish and English UI, light and dark mode | §7.8, HU-30; DT-31, DT-43 | F0 | H1-B1 | H2-B2 (persist locale/theme/time zone) |
| 18 | In-app alerts | §7.9, HU-10 CA4, HU-19 CA2 | F4 | H1-B2 (`AlertList` + mock rules, module overviews) · H1-B5 (bell panel, dashboard) | H2-B6 (live alert queries, `AlertDismissal`) |
| 19 | Configurable catalogs: technologies, document types and categories, expense categories, payment methods, currencies, exchange rates, fiscal parameters (incl. allowed VAT rates) | §8.15, §10.4, HU-06, HU-21; DT-44 | F1/F2/F3 | H1-B2 (technologies, tags) · H1-B3 (currencies, rates, fiscal, payment methods, expense categories) · H1-B4 (document categories/types) · H1-B5 (company) | H2-B1 (seed) · H2-B3 (technologies, tags) · H2-B4 (finance catalogs) · H2-B5 (document types) · H2-B2 (company) |

## 2. PRD §8 module views

| PRD § | Module / view | Hito 1 | Hito 2 |
|---|---|---|---|
| 8.1 | Dashboard | H1-B5 | H2-B6 |
| 8.2 | Clients: overview, table, forms, detail (Resumen, Contactos, Proyectos, Facturas, Pagos, Documentos, Notas, Actividad, Grafo) | H1-B2 (Facturas/Pagos tabs wired in H1-B3; Grafo in H1-B5) | H2-B3 |
| 8.2 | Contacts | H1-B2 | H2-B3 |
| 8.3 | Projects: overview, table, forms, detail, transitions, links, stack | H1-B2 (Cobro tab in H1-B3; Grafo in H1-B5) | H2-B3 |
| 8.4 | Billing plan | H1-B3 | H2-B4 |
| 8.5 | Invoices (multi-rate lines, DT-44) | H1-B3 | H2-B4 |
| 8.6 | Payments | H1-B3 | H2-B4 |
| 8.7 | Accounts | H1-B3 | H2-B4 |
| 8.8 | Expenses + recurring expenses | H1-B3 | H2-B4 |
| 8.9 | Documents | H1-B4 | H2-B5 |
| 8.10 | Notes | H1-B2 | H2-B3 |
| 8.11 | Portal and share links (access keys, DT-45) | H1-B4 | H2-B5 |
| 8.12 | Graph (entity and global) | H1-B5 | H2-B6 |
| 8.13 | Reports and KPIs | H1-B5 | H2-B6 |
| 8.14 | Activity log | H1-B2 | H2-B2 (writer) · H2-B3 (reader) |
| 8.15 | Settings sections | preferences H1-B1 · technologies, tags H1-B2 · finance catalogs H1-B3 · document types H1-B4 · company, users, trash H1-B5 | preferences, users, company H2-B2 · technologies, tags H2-B3 · finance catalogs H2-B4 · document types H2-B5 · trash H2-B6 |

## 3. PRD §12 services and scheduled jobs

| Service group (§12) | Hito 1 (mock service, same signature) | Hito 2 (real service) |
|---|---|---|
| clients, contacts | H1-B2 | H2-B3 |
| projects | H1-B2 | H2-B3 |
| billing | H1-B3 | H2-B4 |
| invoices | H1-B3 | H2-B4 |
| payments | H1-B3 | H2-B4 |
| accounts | H1-B3 | H2-B4 |
| expenses | H1-B3 | H2-B4 |
| documents | H1-B4 | H2-B5 |
| notes | H1-B2 | H2-B3 |
| files (`requestUpload`, `confirmUpload`, `getDownloadUrl`) | H1-B1 (mock `UploadAdapter`) | H2-B2 |
| shares (`createShareLink`…, `resolveShareToken`, `recordShareAccess`, + `setShareDocumentAccessKey`, `unlockSharedDocument`) | H1-B4 | H2-B5 |
| graph | H1-B5 | H2-B6 |
| search (`searchGlobal`, `reindexEntity`) | H1-B5 (`searchGlobal` mock) | H2-B2 (`reindexEntity`) · H2-B6 (`searchGlobal`) |
| reports | H1-B5 | H2-B6 |
| activity (`logActivity`, `listActivity`) | H1-B2 | H2-B2 (`logActivity`) · H2-B3 (`listActivity`) |
| settings (catalog CRUD, `upsertExchangeRate`, `importRatesCsv`, `getRateFor`) | H1-B1 (`getRateFor` + catalog reads) · H1-B2/B3/B4 (catalog screens) | H2-B3/B4/B5 per catalog |
| tags | H1-B2 | H2-B3 |
| export (`exportCsv`) | H1-B1 (kit export action over mock queries) | H2-B6 |
| Auth: webhook sync, `getCurrentUser`, `can()` | H1-B1 (`can()` + mock session) | H2-B2 |
| Job `daily-maintenance` steps 1–5 | not applicable (mock `SYSTEM_JOB` activity entries) | step logic: H2-B4 (1, 3, 4), H2-B5 (2, 5); scheduled function wiring: H2-B6 |
| Job `cleanup-files` | not applicable | H2-B6 |

## 4. PRD §11 routes (Hito 1 navigability check)

| Route group | Hito 1 batch |
|---|---|
| `/sign-in`, `/`, `(app)` layout, `/dashboard` placeholder, `/settings` layout, `/settings/preferences` | H1-B1 |
| `/clients/**`, `/projects` (+ `list`, `new`, `[id]`, `[id]/edit`), `/notes/**`, `/activity`, `/settings/technologies`, `/settings/tags` | H1-B2 |
| `/projects/[id]/billing`, `/invoices/**`, `/payments/**`, `/expenses/**`, `/accounts/**`, `/settings/{currencies,rates,fiscal,payment-methods,expense-categories}` | H1-B3 |
| `/documents/**` (incl. `editor`, `versions/[versionId]`, `shares`, `shares/[id]`), `/settings/document-types`, `/s/[token]` | H1-B4 |
| `/dashboard` (final), every `/<entity>/[id]/graph`, `/graph`, `/reports`, `/reports/[report]`, `/settings/{company,users,trash}` | H1-B5 |
| `/api/webhooks/clerk`, `/api/files/[id]/download`, `/api/s/[token]/files/[documentId]` | Hito 2 only (H2-B2, H2-B2, H2-B5); Hito 1 download buttons use the mock adapter |

## 5. User stories (PRD §13) — where their acceptance criteria close

Hito 1 closes the **UI behaviour** of each story over mocks (E2E against local `next start`); the
acceptance criteria close **fully** in the Hito 2 block (E2E locally on podman Postgres, in CI on the
Neon testing DB, and on the deploy preview by the user).

| HU | Hito 1 (UI) | Hito 2 (closes) |
|---|---|---|
| HU-01, HU-02 | H1-B1, H1-B5 | H2-B2 |
| HU-03 … HU-08 | H1-B2 | H2-B3 |
| HU-09, HU-10 | H1-B3 | H2-B4 (HU-10 CA1–CA3) · H2-B6 (HU-10 CA4) |
| HU-11 (with multi-rate lines, DT-44), HU-12 … HU-17 | H1-B3 | H2-B4 (HU-12 CA4 job: H2-B6) |
| HU-18 … HU-21 | H1-B4 | H2-B5 (HU-19 CA2–CA3: H2-B6) |
| HU-22 (+ access keys, DT-45) | H1-B4 | H2-B5 |
| HU-23 | H1-B2 | H2-B3 |
| HU-24, HU-25, HU-26 | H1-B5 | H2-B6 |
| HU-27 | H1-B1 (kit) | H2-B2 (CA1) · H2-B6 (CA2) |
| HU-28 | H1-B2–B5 | H2-B6 |
| HU-29 | H1-B2 | H2-B3 |
| HU-30 | H1-B1 | H2-B2 |
| HU-31 | H1-B5 | H2-B6 |

Critical stories for E2E (PRD §14): HU 03, 09, 11, 13, 18, 22, 24 — re-verified in H2-B7.
