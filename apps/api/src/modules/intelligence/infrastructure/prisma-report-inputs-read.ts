import { Injectable } from '@nestjs/common';
import { toDateOnly, type DateOnly } from '../../../shared/domain/business-date';
import type { ProjectStatus } from '../../../shared/domain/enums';
import type { MoneyString } from '../../../shared/domain/money';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { FactFilter } from '../application/ports/finance-facts-read.port';
import type {
  AccountBalanceRow,
  AccountFlowRow,
  CategoryMonthRow,
  ClientCollectionDay,
  KpiClientRow,
  KpiProjectRow,
  LabelKind,
  LabelRow,
  ProjectFlowRow,
  ReceivableClose,
  RecurringChargeRow,
  RecurringExpenseRow,
  ReportInputsReadPort,
  ReportScope,
  ScopeRecordKind,
  TaxesByMonth,
  TaxWithholdingMonthRow,
} from '../application/ports/report-inputs-read.port';
import type { DateRange } from '../domain/report-range';

const ZERO = '0.00';
/** The seeded types the coverage KPI looks for (prisma/seed-data/document-types.ts: stable natural keys). */
const CONTRACT_TYPE_ID = 'dtyp_contrato_servicios';
const NDA_TYPE_ID = 'dtyp_nda';
const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = ['EN_CURSO', 'MANTENIMIENTO'];

/** Sum of an `amountUsd` expression as a two-decimal string; Node never sees a float (C15). */
const money = (expression: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`COALESCE(${expression}, 0)::numeric(38,2)::text`;
const day = (column: Prisma.Sql): Prisma.Sql => Prisma.sql`to_char(${column}, 'YYYY-MM-DD')`;
const hasScope = (scope: ReportScope): boolean =>
  Boolean(scope.clientId || scope.projectId || scope.tagId);

/** `AND`-joined conditions over the fact aliased `f`, the same narrowing as the facts port (DT-170). */
function factScope(filter: FactFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filter.clientId) conditions.push(Prisma.sql`f."clientId" = ${filter.clientId}`);
  if (filter.projectId) conditions.push(Prisma.sql`f."projectId" = ${filter.projectId}`);
  if (filter.tagId) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "TagAssignment" ta
      WHERE ta."tagId" = ${filter.tagId}
        AND (ta."clientId" = f."clientId" OR ta."projectId" = f."projectId"))`);
  }
  return Prisma.join(conditions, ' AND ');
}

/** Conditions over the project aliased `p`: the project itself, one of its clients, or its tag. */
function projectScope(scope: ReportScope): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (scope.projectId) conditions.push(Prisma.sql`p."id" = ${scope.projectId}`);
  if (scope.clientId) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProjectClient" pc WHERE pc."projectId" = p."id" AND pc."clientId" = ${scope.clientId})`);
  }
  if (scope.tagId) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "TagAssignment" ta WHERE ta."tagId" = ${scope.tagId} AND ta."projectId" = p."id")`);
  }
  return Prisma.join(conditions, ' AND ');
}

/** Conditions over the client aliased `c`: the client itself, a project it takes part in, or its tag. */
function clientScope(scope: ReportScope): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (scope.clientId) conditions.push(Prisma.sql`c."id" = ${scope.clientId}`);
  if (scope.projectId) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProjectClient" pc WHERE pc."clientId" = c."id" AND pc."projectId" = ${scope.projectId})`);
  }
  if (scope.tagId) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "TagAssignment" ta WHERE ta."tagId" = ${scope.tagId} AND ta."clientId" = c."id")`);
  }
  return Prisma.join(conditions, ' AND ');
}

const between = (range: DateRange): Prisma.Sql =>
  Prisma.sql`f."date" BETWEEN ${range.from}::date AND ${range.to}::date`;

const LABEL_QUERIES: Record<LabelKind, (ids: string[]) => Prisma.Sql> = {
  CLIENT: (ids) => Prisma.sql`
    SELECT "id", "tradeName" AS "label", "code" FROM "Client" WHERE "id" = ANY(${ids}::text[])`,
  PROJECT: (ids) => Prisma.sql`
    SELECT "id", "name" AS "label", "code" FROM "Project" WHERE "id" = ANY(${ids}::text[])`,
  ACCOUNT: (ids) => Prisma.sql`
    SELECT "id", "name" AS "label", NULL::text AS "code" FROM "Account" WHERE "id" = ANY(${ids}::text[])`,
  TECHNOLOGY: (ids) => Prisma.sql`
    SELECT "id", "name" AS "label", NULL::text AS "code" FROM "Technology" WHERE "id" = ANY(${ids}::text[])`,
  CATEGORY: (ids) => Prisma.sql`
    SELECT "id", "name" AS "label", NULL::text AS "code" FROM "ExpenseCategory" WHERE "id" = ANY(${ids}::text[])`,
  METHOD: (ids) => Prisma.sql`
    SELECT "id", "name" AS "label", "code" FROM "PaymentMethod" WHERE "id" = ANY(${ids}::text[])`,
};

const EXISTS_QUERIES: Record<ScopeRecordKind, (id: string) => Prisma.Sql> = {
  CLIENT: (id) =>
    Prisma.sql`SELECT 1 AS "found" FROM "Client" WHERE "id" = ${id} AND "deletedAt" IS NULL`,
  PROJECT: (id) =>
    Prisma.sql`SELECT 1 AS "found" FROM "Project" WHERE "id" = ${id} AND "deletedAt" IS NULL`,
  TAG: (id) => Prisma.sql`SELECT 1 AS "found" FROM "Tag" WHERE "id" = ${id}`,
};

/**
 * Report and KPI inputs over `FinanceFact` and the source tables with raw SQL aggregates (DT-102, DT-170):
 * sums happen in the database and reach Node as text (C15). Reads only. The soft-delete extension does not
 * reach raw SQL, so every read of a live table filters `deletedAt` itself; facts of a voided, draft or
 * archived source no longer exist (the projector deletes them with the source write). Every value that
 * comes from a caller is a bound parameter.
 */
@Injectable()
export class PrismaReportInputsRead implements ReportInputsReadPort {
  constructor(private readonly host: TransactionHost) {}

  async exists(kind: ScopeRecordKind, id: string): Promise<boolean> {
    const rows = await this.host.db.$queryRaw<{ found: number }[]>(EXISTS_QUERIES[kind](id));
    return rows.length > 0;
  }

  async labels(kind: LabelKind, ids: readonly string[]): Promise<LabelRow[]> {
    if (ids.length === 0) return [];
    return this.host.db.$queryRaw<LabelRow[]>(LABEL_QUERIES[kind]([...ids]));
  }

  async expensesByMonthCategory(range: DateRange, scope: ReportScope): Promise<CategoryMonthRow[]> {
    // The category is resolved to its root here, at read time, walking the tree upwards (depth capped).
    return this.host.db.$queryRaw<CategoryMonthRow[]>`
      WITH RECURSIVE "up" AS (
        SELECT c."id" AS "startId", c."id" AS "curId", c."parentId" AS "parentId", 0 AS "depth"
        FROM "ExpenseCategory" c
        UNION ALL
        SELECT u."startId", p."id", p."parentId", u."depth" + 1
        FROM "up" u JOIN "ExpenseCategory" p ON p."id" = u."parentId" WHERE u."depth" < 32),
      "roots" AS (SELECT u."startId", u."curId" AS "rootId" FROM "up" u WHERE u."parentId" IS NULL)
      SELECT to_char(f."date", 'YYYY-MM') AS "month", r."rootId" AS "categoryId",
             ${money(Prisma.sql`SUM(f."amountUsd")`)} AS "amountUsd"
      FROM "FinanceFact" f JOIN "roots" r ON r."startId" = f."categoryId"
      WHERE f."kind" = 'EXPENSE_PAID' AND ${between(range)} AND ${factScope(scope)}
      GROUP BY to_char(f."date", 'YYYY-MM'), r."rootId"
      ORDER BY to_char(f."date", 'YYYY-MM'), r."rootId" COLLATE "C"`;
  }

  async accountFlow(range: DateRange, scope: ReportScope): Promise<AccountFlowRow[]> {
    // An adjustment is a `MOVEMENT_IN` carrying its sign (DT-106): a negative one is money out.
    return this.host.db.$queryRaw<AccountFlowRow[]>`
      SELECT f."accountId" AS "accountId", to_char(f."date", 'YYYY-MM') AS "month",
             ${money(Prisma.sql`SUM(CASE
               WHEN f."kind" IN ('COLLECTED', 'TRANSFER_IN') THEN f."amountUsd"
               WHEN f."kind" = 'MOVEMENT_IN' AND f."amountUsd" > 0 THEN f."amountUsd"
               ELSE 0 END)`)} AS "inflowUsd",
             ${money(Prisma.sql`SUM(CASE
               WHEN f."kind" IN ('EXPENSE_PAID', 'TRANSFER_OUT', 'MOVEMENT_OUT') THEN f."amountUsd"
               WHEN f."kind" = 'MOVEMENT_IN' AND f."amountUsd" < 0 THEN -f."amountUsd"
               ELSE 0 END)`)} AS "outflowUsd"
      FROM "FinanceFact" f
      WHERE f."accountId" IS NOT NULL
        AND f."kind" IN ('COLLECTED', 'TRANSFER_IN', 'MOVEMENT_IN', 'EXPENSE_PAID', 'TRANSFER_OUT', 'MOVEMENT_OUT')
        AND ${between(range)} AND ${factScope(scope)}
      GROUP BY f."accountId", to_char(f."date", 'YYYY-MM')
      ORDER BY to_char(f."date", 'YYYY-MM'), f."accountId" COLLATE "C"`;
  }

  async taxesByMonth(range: DateRange, scope: ReportScope): Promise<TaxesByMonth> {
    // The invoices of the scope: those with a `BILLED` fact in the range that matches it.
    const invoices = Prisma.sql`
      SELECT f."invoiceId" AS "invoiceId", MIN(f."date") AS "issued"
      FROM "FinanceFact" f
      WHERE f."kind" = 'BILLED' AND f."invoiceId" IS NOT NULL AND ${between(range)} AND ${factScope(scope)}
      GROUP BY f."invoiceId"`;
    // IGTF has no project: with a project or tag filter it follows the payment's allocations.
    const igtfScope =
      scope.projectId || scope.tagId
        ? Prisma.sql`f."sourceId" IN (
            SELECT f."sourceId" FROM "FinanceFact" f
            WHERE f."sourceType" = 'PAYMENT' AND f."kind" = 'COLLECTED' AND ${factScope(scope)})`
        : factScope(scope);

    const rates = await this.host.db.$queryRaw<TaxesByMonth['rates']>`
      WITH "scoped" AS (${invoices})
      SELECT to_char(s."issued", 'YYYY-MM') AS "month", tl."ivaRate"::numeric(5,2)::text AS "ivaRate",
             ${money(Prisma.sql`SUM(ROUND(tl."taxBase" / i."usdRate", 2))`)} AS "taxBaseUsd",
             ${money(Prisma.sql`SUM(iva."amountUsd")`)} AS "ivaAmountUsd"
      FROM "scoped" s
      JOIN "Invoice" i ON i."id" = s."invoiceId"
      JOIN "InvoiceTaxLine" tl ON tl."invoiceId" = i."id"
      LEFT JOIN (
        SELECT x."invoiceId", x."ivaRate", SUM(x."amountUsd") AS "amountUsd"
        FROM "FinanceFact" x
        WHERE x."kind" = 'IVA' AND x."invoiceId" IN (SELECT "invoiceId" FROM "scoped")
        GROUP BY x."invoiceId", x."ivaRate"
      ) iva ON iva."invoiceId" = tl."invoiceId" AND iva."ivaRate" = tl."ivaRate"
      GROUP BY 1, 2
      ORDER BY 1, 2`;

    const withheld = await this.host.db.$queryRaw<Omit<TaxWithholdingMonthRow, 'igtfUsd'>[]>`
      WITH "scoped" AS (${invoices})
      SELECT to_char(f."date", 'YYYY-MM') AS "month",
             ${money(Prisma.sql`SUM(f."amountUsd") FILTER (WHERE f."kind" = 'WITHHELD_IVA')`)} AS "ivaWithheldUsd",
             ${money(Prisma.sql`SUM(f."amountUsd") FILTER (WHERE f."kind" = 'WITHHELD_ISLR')`)} AS "islrWithheldUsd",
             ${money(Prisma.sql`SUM(f."amountUsd") FILTER (WHERE f."kind" = 'WITHHELD_OTHER')`)} AS "otherWithheldUsd"
      FROM "FinanceFact" f
      WHERE f."kind" IN ('WITHHELD_IVA', 'WITHHELD_ISLR', 'WITHHELD_OTHER')
        AND f."invoiceId" IN (SELECT "invoiceId" FROM "scoped") AND ${between(range)}
      GROUP BY 1
      ORDER BY 1`;

    const igtf = await this.host.db.$queryRaw<{ month: string; igtfUsd: MoneyString }[]>`
      SELECT to_char(f."date", 'YYYY-MM') AS "month", ${money(Prisma.sql`SUM(f."amountUsd")`)} AS "igtfUsd"
      FROM "FinanceFact" f
      WHERE f."kind" = 'IGTF' AND ${between(range)} AND ${igtfScope}
      GROUP BY 1
      ORDER BY 1`;

    const byMonth = new Map<string, TaxWithholdingMonthRow>();
    for (const row of withheld) byMonth.set(row.month, { ...row, igtfUsd: ZERO });
    for (const row of igtf) {
      const entry = byMonth.get(row.month) ?? {
        month: row.month,
        ivaWithheldUsd: ZERO,
        islrWithheldUsd: ZERO,
        otherWithheldUsd: ZERO,
        igtfUsd: ZERO,
      };
      byMonth.set(row.month, { ...entry, igtfUsd: row.igtfUsd });
    }
    return {
      rates,
      withholdings: [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    };
  }

  async receivableAt(closes: readonly DateOnly[], scope: ReportScope): Promise<ReceivableClose[]> {
    if (closes.length === 0) return [];
    const scoped = factScope(scope);
    // The definition of `FinanceFactsReadPort.receivableAt` (DT-125), for many close dates at once; an
    // integration test pins both to the same figures. Withholdings carry no project, so a filtered read
    // takes the share of the invoice's withholding that matches its filtered billed amount.
    const rows = await this.host.db.$queryRaw<{ close: string; total: string; overdue: string }[]>`
      WITH "closes" AS (SELECT DISTINCT c AS "close" FROM unnest((${[...closes]}::text[])::date[]) AS c),
      "per" AS (
        SELECT cl."close", f."invoiceId" AS "invoiceId",
               MAX(f."dueDate") FILTER (WHERE f."kind" = 'BILLED' AND ${scoped}) AS "dueDate",
               COALESCE(SUM(f."amountUsd") FILTER (WHERE f."kind" = 'BILLED' AND ${scoped}), 0) AS "billed",
               COALESCE(SUM(f."amountUsd") FILTER (WHERE f."kind" = 'COLLECTED' AND ${scoped}), 0) AS "collected",
               COALESCE(SUM(f."amountUsd") FILTER (WHERE f."kind" = 'BILLED'), 0) AS "wholeBilled",
               COALESCE(SUM(f."amountUsd") FILTER (
                 WHERE f."kind" IN ('WITHHELD_IVA', 'WITHHELD_ISLR', 'WITHHELD_OTHER')), 0) AS "withheld"
        FROM "closes" cl
        JOIN "FinanceFact" f ON f."invoiceId" IS NOT NULL AND f."date" <= cl."close"
        GROUP BY cl."close", f."invoiceId"
        HAVING bool_or(${scoped})),
      "open" AS (
        SELECT b."close", b."dueDate",
               b."billed" - b."collected"
                 - COALESCE(ROUND(b."withheld" * b."billed" / NULLIF(b."wholeBilled", 0), 2), 0) AS "balance"
        FROM "per" b
        WHERE b."dueDate" IS NOT NULL)
      SELECT cl."close"::text AS "close",
             ${money(Prisma.sql`SUM(o."balance") FILTER (WHERE o."balance" > 0)`)} AS "total",
             ${money(Prisma.sql`SUM(o."balance") FILTER (WHERE o."balance" > 0 AND o."dueDate" < cl."close")`)} AS "overdue"
      FROM "closes" cl LEFT JOIN "open" o ON o."close" = cl."close"
      GROUP BY cl."close"`;
    const byClose = new Map(rows.map((row) => [row.close, row]));
    return closes.map((close) => {
      const row = byClose.get(close);
      return { close, totalUsd: row?.total ?? ZERO, overdueUsd: row?.overdue ?? ZERO };
    });
  }

  async collectionsByClientDay(upTo: DateOnly, scope: ReportScope): Promise<ClientCollectionDay[]> {
    return this.host.db.$queryRaw<ClientCollectionDay[]>`
      SELECT f."clientId" AS "clientId", ${day(Prisma.sql`f."date"`)} AS "date",
             ${money(Prisma.sql`SUM(f."amountUsd")`)} AS "amountUsd"
      FROM "FinanceFact" f
      WHERE f."kind" = 'COLLECTED' AND f."clientId" IS NOT NULL AND f."date" <= ${upTo}::date
        AND ${factScope(scope)}
      GROUP BY f."clientId", f."date"
      ORDER BY f."date", f."clientId" COLLATE "C"`;
  }

  async projectFlows(windows: readonly DateRange[], scope: ReportScope): Promise<ProjectFlowRow[]> {
    if (windows.length === 0) return [];
    const rows = await this.host.db.$queryRaw<
      { window: number; projectId: string; collectedUsd: string; expensesUsd: string }[]
    >`
      WITH "w" AS (
        SELECT x."idx", x."from"::date AS "from", x."to"::date AS "to"
        FROM unnest(${windows.map((_, i) => i)}::int[], ${windows.map((w) => w.from)}::text[],
                    ${windows.map((w) => w.to)}::text[]) AS x("idx", "from", "to"))
      SELECT w."idx"::int AS "window", f."projectId" AS "projectId",
             ${money(Prisma.sql`SUM(f."amountUsd") FILTER (WHERE f."kind" = 'COLLECTED')`)} AS "collectedUsd",
             ${money(Prisma.sql`SUM(f."amountUsd") FILTER (WHERE f."kind" = 'EXPENSE_PAID')`)} AS "expensesUsd"
      FROM "w" w
      JOIN "FinanceFact" f ON f."date" BETWEEN w."from" AND w."to"
        AND f."kind" IN ('COLLECTED', 'EXPENSE_PAID') AND f."projectId" IS NOT NULL AND ${factScope(scope)}
      GROUP BY w."idx", f."projectId"
      ORDER BY w."idx", f."projectId" COLLATE "C"`;
    return rows.map((row) => ({ ...row, window: Number(row.window) }));
  }

  async recurringCharges(scope: ReportScope): Promise<RecurringChargeRow[]> {
    return this.host.db.$queryRaw<RecurringChargeRow[]>`
      SELECT ${day(Prisma.sql`rc."startDate"`)} AS "startDate", ${day(Prisma.sql`rc."endDate"`)} AS "endDate",
             rc."status"::text AS "status", rc."monthlyAmountUsd"::numeric(38,2)::text AS "monthlyAmountUsd"
      FROM "RecurringCharge" rc
      JOIN "Project" p ON p."id" = rc."projectId" AND p."deletedAt" IS NULL
      WHERE ${projectScope(scope)}
      ORDER BY rc."startDate", rc."id"`;
  }

  async recurringExpenses(scope: ReportScope): Promise<RecurringExpenseRow[]> {
    const inScope = hasScope(scope)
      ? Prisma.sql`EXISTS (SELECT 1 FROM "Project" p
          WHERE p."id" = re."projectId" AND p."deletedAt" IS NULL AND ${projectScope(scope)})`
      : Prisma.sql`TRUE`;
    return this.host.db.$queryRaw<RecurringExpenseRow[]>`
      SELECT re."status"::text AS "status", re."monthlyAmountUsd"::numeric(38,2)::text AS "monthlyAmountUsd"
      FROM "RecurringExpense" re
      WHERE re."deletedAt" IS NULL AND ${inScope}
      ORDER BY re."id"`;
  }

  async accountBalances(): Promise<AccountBalanceRow[]> {
    return this.host.db.$queryRaw<AccountBalanceRow[]>`
      SELECT a."currency", a."balance"::numeric(38,2)::text AS "balance"
      FROM "Account" a
      WHERE a."active" AND a."deletedAt" IS NULL
      ORDER BY a."id"`;
  }

  async kpiProjects(scope: ReportScope): Promise<KpiProjectRow[]> {
    const projects = await this.host.db.$queryRaw<
      {
        id: string;
        status: ProjectStatus;
        startDate: DateOnly | null;
        targetEndDate: DateOnly | null;
        endDate: DateOnly | null;
        contractedUsd: MoneyString | null;
        technologyIds: string[];
      }[]
    >`
      SELECT p."id", p."status"::text AS "status", ${day(Prisma.sql`p."startDate"`)} AS "startDate",
             ${day(Prisma.sql`p."targetEndDate"`)} AS "targetEndDate", ${day(Prisma.sql`p."endDate"`)} AS "endDate",
             bp."contractedUsd"::numeric(38,2)::text AS "contractedUsd",
             COALESCE((SELECT array_agg(pt."technologyId" ORDER BY pt."technologyId")
                       FROM "ProjectTechnology" pt WHERE pt."projectId" = p."id"), ARRAY[]::text[]) AS "technologyIds"
      FROM "Project" p LEFT JOIN "BillingPlan" bp ON bp."projectId" = p."id"
      WHERE p."deletedAt" IS NULL AND ${projectScope(scope)}
      ORDER BY p."id"`;

    // Documents around the active projects only: linked to the project or to one of its clients.
    const active = projects
      .filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status))
      .map((p) => p.id);
    const documents =
      active.length === 0
        ? []
        : await this.host.db.$queryRaw<
            { projectId: string; typeId: string; status: string; expiresAt: DateOnly | null }[]
          >`
            SELECT DISTINCT p."id" AS "projectId", d."id" AS "documentId", d."typeId" AS "typeId",
                   d."status"::text AS "status", ${day(Prisma.sql`d."expiresAt"`)} AS "expiresAt"
            FROM "Project" p
            JOIN "DocumentLink" dl ON dl."projectId" = p."id"
              OR dl."clientId" IN (SELECT pc."clientId" FROM "ProjectClient" pc WHERE pc."projectId" = p."id")
            JOIN "Document" d ON d."id" = dl."documentId" AND d."deletedAt" IS NULL
            WHERE p."id" = ANY(${active}::text[]) AND d."typeId" IN (${CONTRACT_TYPE_ID}, ${NDA_TYPE_ID})`;

    return projects.map((project) => {
      const own = documents.filter((doc) => doc.projectId === project.id);
      return {
        ...project,
        hasSignedContract: own.some(
          (doc) => doc.typeId === CONTRACT_TYPE_ID && doc.status === 'FIRMADO',
        ),
        ndaExpiries: own
          .filter(
            (doc) =>
              doc.typeId === NDA_TYPE_ID && doc.status !== 'VENCIDO' && doc.status !== 'ANULADO',
          )
          .map((doc) => doc.expiresAt),
      };
    });
  }

  async kpiClients(scope: ReportScope): Promise<KpiClientRow[]> {
    const rows = await this.host.db.$queryRaw<
      { id: string; createdAt: Date; activatedAt: Date | null }[]
    >`
      SELECT c."id", c."createdAt", c."activatedAt"
      FROM "Client" c
      WHERE c."deletedAt" IS NULL AND ${clientScope(scope)}
      ORDER BY c."id"`;
    return rows.map((row) => ({
      id: row.id,
      createdAt: toDateOnly(row.createdAt),
      activatedAt: row.activatedAt ? toDateOnly(row.activatedAt) : null,
    }));
  }
}
