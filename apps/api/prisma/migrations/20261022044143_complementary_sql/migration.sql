-- Complementary SQL (PRD §10.3 + data-rules §3a Δ1 CHECKs + §3b Δ9 view and query indexes).
-- Hand-written: Prisma cannot express these. Follow the drift procedure in README.md.

-- ───────────── Extensions ─────────────
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ───────────── Polymorphic links: exactly one non-null FK ─────────────
ALTER TABLE "DocumentLink"  ADD CONSTRAINT doclink_one_target
  CHECK (num_nonnulls("clientId","contactId","projectId","invoiceId","paymentId","expenseId") = 1);
ALTER TABLE "NoteLink"      ADD CONSTRAINT notelink_one_target
  CHECK (num_nonnulls("clientId","contactId","projectId","documentId","invoiceId","paymentId","expenseId") = 1);
ALTER TABLE "TagAssignment" ADD CONSTRAINT tag_one_target
  CHECK (num_nonnulls("clientId","contactId","projectId","invoiceId","paymentId","expenseId","documentId","noteId") = 1);

-- ───────────── Uniques that respect soft delete ─────────────
CREATE UNIQUE INDEX IF NOT EXISTS client_taxid_country_active ON "Client"("taxId","country") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_number_active       ON "Invoice"("invoiceNumber") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS allocation_unique_active    ON "PaymentAllocation"("paymentId","invoiceId") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contact_one_primary         ON "Contact"("clientId") WHERE "isPrimary" AND "deletedAt" IS NULL;

-- ───────────── Integrity rules ─────────────
ALTER TABLE "RecurringCharge"  ADD CONSTRAINT rc_billing_day  CHECK ("billingDay"  BETWEEN 1 AND 28);
ALTER TABLE "RecurringExpense" ADD CONSTRAINT re_day          CHECK ("dayOfPeriod" BETWEEN 1 AND 28);
ALTER TABLE "AccountTransfer"  ADD CONSTRAINT tr_diff_account CHECK ("fromAccountId" <> "toAccountId");
ALTER TABLE "Payment"          ADD CONSTRAINT pay_amounts     CHECK ("amount" > 0 AND "igtfAmount" >= 0 AND "feeAmount" >= 0);

-- ───────────── Δ1 multi-rate invoice CHECKs ─────────────
ALTER TABLE "InvoiceLine"    ADD CONSTRAINT invline_discount CHECK ("discount" >= 0 AND "discount" <= "amount");
ALTER TABLE "InvoiceLine"    ADD CONSTRAINT invline_rate     CHECK ("ivaRate" IS NULL OR "ivaRate" BETWEEN 0 AND 100);
ALTER TABLE "InvoiceTaxLine" ADD CONSTRAINT invtax_adjust    CHECK (abs("ivaAmount" - round("taxBase" * "ivaRate" / 100, 2)) <= 0.01);

-- ───────────── Search ─────────────
CREATE TEXT SEARCH CONFIGURATION es_unaccent ( COPY = simple );
ALTER TEXT SEARCH CONFIGURATION es_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

ALTER TABLE "SearchEntry" ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('es_unaccent', coalesce("code",'')),     'A') ||
  setweight(to_tsvector('es_unaccent', coalesce("title",'')),    'A') ||
  setweight(to_tsvector('es_unaccent', coalesce("subtitle",'')), 'B') ||
  setweight(to_tsvector('es_unaccent', coalesce("body",'')),     'C')
) STORED;
CREATE INDEX IF NOT EXISTS search_entry_fts  ON "SearchEntry" USING GIN (search);
CREATE INDEX IF NOT EXISTS search_entry_trgm ON "SearchEntry" USING GIN ("title" gin_trgm_ops);

-- ───────────── Δ9: account ledger view (running balance) ─────────────
-- One row per balance-affecting movement per account, signed in the account currency.
-- ord orders rows of the same date: opening, payments, expenses, transfers out, transfers in, movements.
CREATE OR REPLACE VIEW account_ledger_v AS
WITH entries AS (
  SELECT a."id" AS "accountId", a."openingDate" AS "date", 0 AS ord, 'OPENING'::text AS kind,
         a."id" AS "sourceId", a."openingBalance" AS amount, a."createdAt" AS "createdAt"
    FROM "Account" a
  UNION ALL
  SELECT p."accountId", p."date", 1, 'PAYMENT', p."id", p."netCredited", p."createdAt"
    FROM "Payment" p
   WHERE p."status" = 'CONFIRMADO' AND p."deletedAt" IS NULL
  UNION ALL
  SELECT e."accountId", COALESCE(e."paidAt", e."date"), 2, 'EXPENSE', e."id",
         -COALESCE(e."accountAmount", e."amount"), e."createdAt"
    FROM "Expense" e
   WHERE e."status" = 'PAGADO' AND e."deletedAt" IS NULL AND e."accountId" IS NOT NULL
  UNION ALL
  SELECT t."fromAccountId", t."date", 3, 'TRANSFER_OUT', t."id",
         -(t."amountFrom" + t."feeAmount"), t."createdAt"
    FROM "AccountTransfer" t
   WHERE t."deletedAt" IS NULL
  UNION ALL
  SELECT t."toAccountId", t."date", 4, 'TRANSFER_IN', t."id", t."amountTo", t."createdAt"
    FROM "AccountTransfer" t
   WHERE t."deletedAt" IS NULL
  UNION ALL
  -- DT-106: APORTE_CAPITAL / RETIRO_SOCIO are stored as positive magnitudes (the type gives the sign);
  -- AJUSTE is signed as stored.
  SELECT m."accountId", m."date", 5, 'MOVEMENT', m."id",
         CASE m."type" WHEN 'RETIRO_SOCIO' THEN -m."amount" ELSE m."amount" END, m."createdAt"
    FROM "AccountMovement" m
   WHERE m."deletedAt" IS NULL
)
SELECT "accountId", "date", ord AS seq, kind, "sourceId", amount, "createdAt",
       SUM(amount) OVER (
         PARTITION BY "accountId"
         ORDER BY "date", ord, "createdAt", "sourceId"
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS balance
  FROM entries;

-- ───────────── §3b query indexes (partial / INCLUDE) ─────────────
-- Invoice
CREATE INDEX IF NOT EXISTS inv_open ON "Invoice"("dueDate")
  WHERE "status" IN ('EMITIDA','PARCIAL','VENCIDA') AND NOT "isDraft" AND "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS inv_client_issue ON "Invoice"("clientId", "issueDate" DESC) WHERE "deletedAt" IS NULL;
-- InvoiceLine
CREATE INDEX IF NOT EXISTS invline_project_cover ON "InvoiceLine"("projectId") INCLUDE ("invoiceId", "netAmount");
-- Payment
CREATE INDEX IF NOT EXISTS pay_status_date ON "Payment"("status", "date") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS pay_unallocated ON "Payment"("date")
  WHERE "status" = 'CONFIRMADO' AND "unallocated" > 0 AND "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS pay_pending ON "Payment"("createdAt")
  WHERE "status" = 'PENDIENTE_VERIFICACION' AND "deletedAt" IS NULL;
-- Expense
CREATE INDEX IF NOT EXISTS exp_status_paid ON "Expense"("status", "paidAt") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS exp_category_date ON "Expense"("categoryId", "date") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS exp_account_date ON "Expense"("accountId", "date") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS exp_recurring_pending ON "Expense"("dueDate")
  WHERE "status" = 'PENDIENTE' AND "recurringExpenseId" IS NOT NULL AND "deletedAt" IS NULL;
-- AccountTransfer / AccountMovement
CREATE INDEX IF NOT EXISTS transfer_from_date ON "AccountTransfer"("fromAccountId", "date") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS transfer_to_date ON "AccountTransfer"("toAccountId", "date") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS movement_account_date ON "AccountMovement"("accountId", "date") WHERE "deletedAt" IS NULL;
-- BillingInstallment
CREATE INDEX IF NOT EXISTS inst_pending ON "BillingInstallment"("dueDate") WHERE "status" = 'PENDIENTE';
-- Document
CREATE INDEX IF NOT EXISTS doc_expiring ON "Document"("expiresAt")
  WHERE "status" NOT IN ('ANULADO','VENCIDO') AND "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS doc_status_updated ON "Document"("status", "updatedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS doc_type ON "Document"("typeId") WHERE "deletedAt" IS NULL;
-- DocumentLink reverse lookups
CREATE INDEX IF NOT EXISTS doclink_contact ON "DocumentLink"("contactId") WHERE "contactId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS doclink_payment ON "DocumentLink"("paymentId") WHERE "paymentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS doclink_expense ON "DocumentLink"("expenseId") WHERE "expenseId" IS NOT NULL;
-- NoteLink
CREATE INDEX IF NOT EXISTS notelink_contact ON "NoteLink"("contactId") WHERE "contactId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS notelink_invoice ON "NoteLink"("invoiceId") WHERE "invoiceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS notelink_payment ON "NoteLink"("paymentId") WHERE "paymentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS notelink_expense ON "NoteLink"("expenseId") WHERE "expenseId" IS NOT NULL;
-- TagAssignment (one per target FK)
CREATE INDEX IF NOT EXISTS tag_client   ON "TagAssignment"("clientId")   WHERE "clientId"   IS NOT NULL;
CREATE INDEX IF NOT EXISTS tag_contact  ON "TagAssignment"("contactId")  WHERE "contactId"  IS NOT NULL;
CREATE INDEX IF NOT EXISTS tag_project  ON "TagAssignment"("projectId")  WHERE "projectId"  IS NOT NULL;
CREATE INDEX IF NOT EXISTS tag_invoice  ON "TagAssignment"("invoiceId")  WHERE "invoiceId"  IS NOT NULL;
CREATE INDEX IF NOT EXISTS tag_payment  ON "TagAssignment"("paymentId")  WHERE "paymentId"  IS NOT NULL;
CREATE INDEX IF NOT EXISTS tag_expense  ON "TagAssignment"("expenseId")  WHERE "expenseId"  IS NOT NULL;
CREATE INDEX IF NOT EXISTS tag_document ON "TagAssignment"("documentId") WHERE "documentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS tag_note     ON "TagAssignment"("noteId")     WHERE "noteId"     IS NOT NULL;
-- RecurringExpense (DT-107)
CREATE INDEX IF NOT EXISTS re_active ON "RecurringExpense"("startDate")
  WHERE "status" = 'ACTIVO' AND "deletedAt" IS NULL;
-- Client / Project
CREATE INDEX IF NOT EXISTS client_status_created ON "Client"("status", "createdAt") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS client_activated ON "Client"("activatedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS project_status_target ON "Project"("status", "targetEndDate") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS project_start ON "Project"("startDate") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS project_end ON "Project"("endDate") WHERE "deletedAt" IS NULL;
-- ClientMetrics
CREATE INDEX IF NOT EXISTS cm_overdue ON "ClientMetrics"("overdueUsd") WHERE "overdueUsd" > 0;
