import { Injectable } from '@nestjs/common';
import type { DateOnly } from '../../../shared/domain/business-date';
import type { MoneyString } from '../../../shared/domain/money';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { FinanceFactKind } from '../../finance/application/kpi-api';
import {
  FACT_KINDS,
  type AgingBuckets,
  type AgingRow,
  type FactDimension,
  type FactFilter,
  type FactGroupRow,
  type FinanceFactsReadPort,
  type IvaByRateRow,
  type KindAmounts,
  type MonthlyFacts,
  type ReceivableAt,
  type ReceivablesAging,
} from '../application/ports/finance-facts-read.port';
import type { DateRange } from '../domain/report-range';

const ZERO = '0.00';
const BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'd90plus'] as const;

const zeroed = <K extends FinanceFactKind>(kinds: readonly K[]): KindAmounts<K> =>
  Object.fromEntries(kinds.map((kind) => [kind, ZERO])) as KindAmounts<K>;
const emptyBuckets = (): AgingBuckets => ({
  d0_30: ZERO,
  d31_60: ZERO,
  d61_90: ZERO,
  d90plus: ZERO,
});

/** `AND`-joined conditions of a filter over the fact aliased `f`. Every value is a bound parameter. */
function filterSql(filter: FactFilter | undefined): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filter?.clientId) conditions.push(Prisma.sql`f."clientId" = ${filter.clientId}`);
  if (filter?.projectId) conditions.push(Prisma.sql`f."projectId" = ${filter.projectId}`);
  if (filter?.tagId) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "TagAssignment" ta
      WHERE ta."tagId" = ${filter.tagId}
        AND (ta."clientId" = f."clientId" OR ta."projectId" = f."projectId"))`);
  }
  return Prisma.join(conditions, ' AND ');
}

/** Sum of an `amountUsd` expression as a two-decimal string; Node never sees a float (C15). */
const money = (expression: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`COALESCE(${expression}, 0)::numeric(38,2)::text`;

/**
 * Per-invoice open balance as of a close date: BILLED - WITHHELD_* - COLLECTED over facts dated up to it,
 * the due date from the BILLED facts (DT-125). Invoices without a BILLED fact, or with no balance left, drop
 * out. Columns: `invoiceId`, `clientId`, `dueDate`, `balance`.
 */
const openBalances = (close: DateOnly, filter: FactFilter | undefined): Prisma.Sql => Prisma.sql`
  SELECT f."invoiceId" AS "invoiceId",
         MAX(f."clientId") FILTER (WHERE f."kind" = 'BILLED') AS "clientId",
         MAX(f."dueDate") FILTER (WHERE f."kind" = 'BILLED') AS "dueDate",
         SUM(CASE
               WHEN f."kind" = 'BILLED' THEN f."amountUsd"
               WHEN f."kind" IN ('COLLECTED', 'WITHHELD_IVA', 'WITHHELD_ISLR', 'WITHHELD_OTHER')
                 THEN -f."amountUsd"
               ELSE 0
             END) AS "balance"
  FROM "FinanceFact" f
  WHERE f."invoiceId" IS NOT NULL AND f."date" <= ${close}::date AND ${filterSql(filter)}
  GROUP BY f."invoiceId"
  HAVING MAX(f."dueDate") FILTER (WHERE f."kind" = 'BILLED') IS NOT NULL
     AND SUM(CASE
               WHEN f."kind" = 'BILLED' THEN f."amountUsd"
               WHEN f."kind" IN ('COLLECTED', 'WITHHELD_IVA', 'WITHHELD_ISLR', 'WITHHELD_OTHER')
                 THEN -f."amountUsd"
               ELSE 0
             END) > 0`;

/**
 * Reads `FinanceFact` with raw SQL aggregates (DT-125, DT-170): sums happen in the database and reach Node as
 * text. Reads only; the soft-delete extension does not reach raw SQL, but facts of a voided, draft or
 * archived source no longer exist (the projector deletes them with the source write), so nothing is hidden
 * here. Every user-supplied value is a bound parameter.
 */
@Injectable()
export class PrismaFinanceFactsRead implements FinanceFactsReadPort {
  constructor(private readonly host: TransactionHost) {}

  async sumByKind(range: DateRange, filter?: FactFilter): Promise<KindAmounts> {
    const rows = await this.host.db.$queryRaw<{ kind: FinanceFactKind; total: string }[]>`
      SELECT f."kind"::text AS "kind", ${money(Prisma.sql`SUM(f."amountUsd")`)} AS "total"
      FROM "FinanceFact" f
      WHERE f."date" BETWEEN ${range.from}::date AND ${range.to}::date AND ${filterSql(filter)}
      GROUP BY f."kind"`;
    const amounts = zeroed(FACT_KINDS);
    for (const row of rows) amounts[row.kind] = row.total;
    return amounts;
  }

  async monthlySeries<K extends FinanceFactKind>(
    range: DateRange,
    kinds: readonly K[],
    filter?: FactFilter,
  ): Promise<MonthlyFacts<K>[]> {
    const rows = await this.host.db.$queryRaw<{ month: string; kind: K; total: string }[]>`
      SELECT to_char(m."month", 'YYYY-MM') AS "month", k."kind" AS "kind",
             ${money(Prisma.sql`SUM(f."amountUsd")`)} AS "total"
      FROM generate_series(
             date_trunc('month', ${range.from}::date::timestamp),
             date_trunc('month', ${range.to}::date::timestamp),
             interval '1 month') AS m("month")
      CROSS JOIN unnest(${[...kinds]}::text[]) AS k("kind")
      LEFT JOIN "FinanceFact" f
        ON f."kind"::text = k."kind"
       AND date_trunc('month', f."date"::timestamp) = m."month"
       AND f."date" BETWEEN ${range.from}::date AND ${range.to}::date
       AND ${filterSql(filter)}
      GROUP BY m."month", k."kind"
      ORDER BY m."month"`;
    const months: MonthlyFacts<K>[] = [];
    for (const row of rows) {
      let entry = months[months.length - 1];
      if (entry?.month !== row.month) {
        entry = { month: row.month, amounts: zeroed(kinds) };
        months.push(entry);
      }
      entry.amounts[row.kind] = row.total;
    }
    return months;
  }

  async sumBy<K extends FinanceFactKind>(
    dimension: FactDimension,
    range: DateRange,
    kinds: readonly K[],
    filter?: FactFilter,
  ): Promise<FactGroupRow<K>[]> {
    // The category is resolved to its root here, at read time, walking the tree upwards (depth capped).
    const roots = Prisma.sql`
      WITH RECURSIVE "up" AS (
        SELECT c."id" AS "startId", c."id" AS "curId", c."parentId" AS "parentId", 0 AS "depth"
        FROM "ExpenseCategory" c
        UNION ALL
        SELECT u."startId", p."id", p."parentId", u."depth" + 1
        FROM "up" u JOIN "ExpenseCategory" p ON p."id" = u."parentId" WHERE u."depth" < 32)
      SELECT u."startId", u."curId" AS "rootId" FROM "up" u WHERE u."parentId" IS NULL`;
    const key = {
      client: Prisma.sql`f."clientId"`,
      project: Prisma.sql`f."projectId"`,
      account: Prisma.sql`f."accountId"`,
      method: Prisma.sql`f."methodId"`,
      category: Prisma.sql`r."rootId"`,
    }[dimension];
    const source =
      dimension === 'category'
        ? Prisma.sql`"FinanceFact" f JOIN "roots" r ON r."startId" = f."categoryId"`
        : Prisma.sql`"FinanceFact" f`;
    const rows = await this.host.db.$queryRaw<{ key: string; kind: K; total: string }[]>`
      WITH "roots" AS (${dimension === 'category' ? roots : Prisma.sql`SELECT NULL::text AS "startId", NULL::text AS "rootId" WHERE FALSE`})
      SELECT ${key} AS "key", f."kind"::text AS "kind", ${money(Prisma.sql`SUM(f."amountUsd")`)} AS "total"
      FROM ${source}
      WHERE f."date" BETWEEN ${range.from}::date AND ${range.to}::date
        AND f."kind"::text = ANY(${[...kinds]}::text[])
        AND ${key} IS NOT NULL
        AND ${filterSql(filter)}
      GROUP BY ${key}, f."kind"
      ORDER BY ${key} COLLATE "C"`;
    const groups: FactGroupRow<K>[] = [];
    for (const row of rows) {
      let entry = groups[groups.length - 1];
      if (entry?.key !== row.key) {
        entry = { key: row.key, amounts: zeroed(kinds) };
        groups.push(entry);
      }
      entry.amounts[row.kind] = row.total;
    }
    return groups;
  }

  async receivableAt(close: DateOnly, filter?: FactFilter): Promise<ReceivableAt> {
    const [row] = await this.host.db.$queryRaw<{ total: string; overdue: string }[]>`
      WITH "open" AS (${openBalances(close, filter)})
      SELECT ${money(Prisma.sql`SUM("balance")`)} AS "total",
             ${money(Prisma.sql`SUM("balance") FILTER (WHERE "dueDate" < ${close}::date)`)} AS "overdue"
      FROM "open"`;
    return { totalUsd: row?.total ?? ZERO, overdueUsd: row?.overdue ?? ZERO };
  }

  async agingAt(close: DateOnly, filter?: FactFilter): Promise<ReceivablesAging> {
    const rows = await this.host.db.$queryRaw<
      { clientId: string; bucket: string; total: string }[]
    >`
      WITH "open" AS (${openBalances(close, filter)})
      SELECT "clientId", CASE
               WHEN ${close}::date - "dueDate" <= 30 THEN 'd0_30'
               WHEN ${close}::date - "dueDate" <= 60 THEN 'd31_60'
               WHEN ${close}::date - "dueDate" <= 90 THEN 'd61_90'
               ELSE 'd90plus'
             END AS "bucket",
             ${money(Prisma.sql`SUM("balance")`)} AS "total"
      FROM "open"
      WHERE "clientId" IS NOT NULL
      GROUP BY 1, 2`;
    const totals = emptyBuckets();
    const byClient = new Map<string, AgingBuckets>();
    for (const row of rows) {
      const bucket = row.bucket as (typeof BUCKETS)[number];
      const buckets = byClient.get(row.clientId) ?? emptyBuckets();
      buckets[bucket] = row.total;
      byClient.set(row.clientId, buckets);
    }
    const sum = (values: readonly MoneyString[]) =>
      values.reduce((acc, value) => new Prisma.Decimal(acc).plus(value).toFixed(2), ZERO);
    for (const bucket of BUCKETS) {
      totals[bucket] = sum([...byClient.values()].map((buckets) => buckets[bucket]));
    }
    const result: AgingRow[] = [...byClient].map(([clientId, buckets]) => ({
      clientId,
      buckets,
      totalUsd: sum(BUCKETS.map((bucket) => buckets[bucket])),
    }));
    result.sort(
      (a, b) =>
        new Prisma.Decimal(b.totalUsd).comparedTo(a.totalUsd) ||
        (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0),
    );
    return { rows: result, totals, totalUsd: sum(BUCKETS.map((bucket) => totals[bucket])) };
  }

  async ivaByRate(range: DateRange, filter?: FactFilter): Promise<IvaByRateRow[]> {
    return this.host.db.$queryRaw<IvaByRateRow[]>`
      SELECT f."ivaRate"::numeric(5,2)::text AS "ivaRate", ${money(Prisma.sql`SUM(f."amountUsd")`)} AS "amountUsd"
      FROM "FinanceFact" f
      WHERE f."kind" = 'IVA' AND f."ivaRate" IS NOT NULL
        AND f."date" BETWEEN ${range.from}::date AND ${range.to}::date AND ${filterSql(filter)}
      GROUP BY f."ivaRate"
      ORDER BY f."ivaRate"`;
  }
}
