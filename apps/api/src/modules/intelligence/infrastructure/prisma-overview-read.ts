import { Injectable } from '@nestjs/common';
import type { DateOnly } from '../../../shared/domain/business-date';
import type { DocumentStatus } from '../../../shared/domain/enums';
import { roundMoney, sumMoney, toUsd, type MoneyString } from '../../../shared/domain/money';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { escapeLike } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ActivityListCriteria } from '../../platform/application/ports/activity-read.port';
import type {
  ActivityCounts,
  DocumentCategoryCounts,
  ExpiringCounts,
  InvoiceCurrencyTotal,
  OverviewReadPort,
  PaymentQueues,
  TechnologyUsageRow,
} from '../application/ports/overview-read.port';

const ids = (values: readonly string[]): Prisma.Sql => Prisma.join([...values]);

/** `ActivityLog` filtered as `GET /activity` filters it (the platform adapter's predicates, counted). */
function activityWhere(c: ActivityListCriteria): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (c.actorIds.length > 0) parts.push(Prisma.sql`a."actorId" IN (${ids(c.actorIds)})`);
  if (c.actorTypes.length > 0) {
    parts.push(Prisma.sql`a."actorType"::text IN (${ids(c.actorTypes)})`);
  }
  if (c.actions.length > 0) parts.push(Prisma.sql`a."action"::text IN (${ids(c.actions)})`);
  if (c.entityTypes.length > 0) {
    parts.push(Prisma.sql`a."entityType"::text IN (${ids(c.entityTypes)})`);
  }
  if (c.entityId !== null) parts.push(Prisma.sql`a."entityId" = ${c.entityId}`);
  if (c.createdFrom) parts.push(Prisma.sql`a."createdAt" >= ${c.createdFrom}`);
  if (c.createdBefore) parts.push(Prisma.sql`a."createdAt" < ${c.createdBefore}`);
  const text = c.search?.trim();
  if (text) {
    const pattern = Prisma.sql`'%' || unaccent(lower(${escapeLike(text)})) || '%'`;
    parts.push(
      Prisma.sql`(unaccent(lower(a."entityLabel")) LIKE ${pattern} ESCAPE '\\'
        OR unaccent(lower(COALESCE(u."name", ''))) LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  return Prisma.join(parts, ' AND ');
}

/**
 * Prisma adapter of `OverviewReadPort`: live aggregates in SQL (soft-deleted rows excluded by hand, raw SQL
 * bypasses the client extension). Every user text is a parameter; every sum comes back as text (C15).
 */
@Injectable()
export class PrismaOverviewRead implements OverviewReadPort {
  constructor(private readonly tx: TransactionHost) {}

  async topTechnologies(limit: number): Promise<TechnologyUsageRow[]> {
    return this.tx.db.$queryRaw<TechnologyUsageRow[]>(Prisma.sql`
      SELECT t."id", t."name", t."nameEn", t."category"::text AS "category", t."iconSlug", t."color",
             COUNT(*)::int AS "projectCount"
      FROM "ProjectTechnology" pt
      JOIN "Project" p ON p."id" = pt."projectId" AND p."deletedAt" IS NULL
      JOIN "Technology" t ON t."id" = pt."technologyId"
      GROUP BY t."id"
      ORDER BY COUNT(*) DESC, t."id" ASC
      LIMIT ${limit}`);
  }

  async invoiceCurrencyTotals(): Promise<InvoiceCurrencyTotal[]> {
    const rows = await this.tx.db.$queryRaw<
      {
        currency: string;
        total: string;
        balance: string;
        overdue: string;
        overdueCount: number;
      }[]
    >(Prisma.sql`
      SELECT i."currency",
             SUM(i."total")::text AS "total",
             SUM(i."balance")::text AS "balance",
             COALESCE(SUM(i."balance") FILTER (WHERE i."status" = 'VENCIDA'), 0)::text AS "overdue",
             (COUNT(*) FILTER (WHERE i."status" = 'VENCIDA' AND i."balance" > 0))::int AS "overdueCount"
      FROM "Invoice" i
      WHERE i."deletedAt" IS NULL AND i."voidedAt" IS NULL AND i."isDraft" = FALSE
        AND i."status" <> 'ANULADA'
      GROUP BY i."currency"
      ORDER BY i."currency" ASC`);
    return rows.map((row) => ({
      currency: row.currency,
      total: roundMoney(row.total),
      balance: roundMoney(row.balance),
      overdue: roundMoney(row.overdue),
      overdueCount: row.overdueCount,
    }));
  }

  async paymentMethodLabels(
    methodIds: readonly string[],
  ): Promise<Map<string, { code: string; name: string }>> {
    if (methodIds.length === 0) return new Map();
    const rows = await this.tx.db.$queryRaw<{ id: string; code: string; name: string }[]>(
      Prisma.sql`SELECT "id", "code", "name" FROM "PaymentMethod" WHERE "id" IN (${ids(methodIds)})`,
    );
    return new Map(rows.map((row) => [row.id, { code: row.code, name: row.name }]));
  }

  async accountNames(accountIds: readonly string[]): Promise<Map<string, string>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.tx.db.$queryRaw<{ id: string; name: string }[]>(
      Prisma.sql`SELECT "id", "name" FROM "Account" WHERE "id" IN (${ids(accountIds)})`,
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async expenseCategoryNames(categoryIds: readonly string[]): Promise<Map<string, string>> {
    if (categoryIds.length === 0) return new Map();
    const rows = await this.tx.db.$queryRaw<{ id: string; name: string }[]>(
      Prisma.sql`SELECT "id", "name" FROM "ExpenseCategory" WHERE "id" IN (${ids(categoryIds)})`,
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async paymentQueues(): Promise<PaymentQueues> {
    const [pending] = await this.tx.db.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "count" FROM "Payment"
      WHERE "deletedAt" IS NULL AND "status" = 'PENDIENTE_VERIFICACION'`);
    const credits = await this.tx.db.$queryRaw<{ unallocated: string; usdRate: string }[]>(
      Prisma.sql`
        SELECT "unallocated"::text AS "unallocated", "usdRate"::text AS "usdRate" FROM "Payment"
        WHERE "deletedAt" IS NULL AND "status" = 'CONFIRMADO' AND "unallocated" > 0`,
    );
    return {
      pendingVerificationCount: pending?.count ?? 0,
      unallocatedCount: credits.length,
      // Each payment converts at its own stored rate and rounds once, then the cents add up.
      unallocatedTotalUsd: sumMoney(credits.map((row) => toUsd(row.unallocated, row.usdRate))),
    };
  }

  async committedMonthlyUsd(): Promise<MoneyString> {
    const [row] = await this.tx.db.$queryRaw<{ total: string }[]>(Prisma.sql`
      SELECT COALESCE(SUM("monthlyAmountUsd"), 0)::text AS "total" FROM "RecurringExpense"
      WHERE "status" = 'ACTIVO' AND "deletedAt" IS NULL`);
    return roundMoney(row?.total ?? '0');
  }

  async documentCategoryCounts(): Promise<DocumentCategoryCounts[]> {
    const [categories, counts] = await Promise.all([
      this.tx.db.$queryRaw<
        { id: string; name: string; nameEn: string | null; color: string | null }[]
      >(Prisma.sql`
        SELECT "id", "name", "nameEn", "color" FROM "DocumentCategory"
        ORDER BY "order" ASC, "id" ASC`),
      this.tx.db.$queryRaw<{ categoryId: string; status: DocumentStatus; count: number }[]>(
        Prisma.sql`
          SELECT dt."categoryId", d."status"::text AS "status", COUNT(*)::int AS "count"
          FROM "Document" d
          JOIN "DocumentType" dt ON dt."id" = d."typeId"
          WHERE d."deletedAt" IS NULL
          GROUP BY dt."categoryId", d."status"`,
      ),
    ]);
    return categories.map((category) => ({
      ...category,
      countByStatus: Object.fromEntries(
        counts
          .filter((entry) => entry.categoryId === category.id)
          .map((entry) => [entry.status, entry.count]),
      ),
    }));
  }

  async documentExpiringCounts(today: DateOnly): Promise<ExpiringCounts> {
    const [row] = await this.tx.db.$queryRaw<ExpiringCounts[]>(Prisma.sql`
      SELECT (COUNT(*) FILTER (WHERE d."expiresAt" <= ${today}::date + 30))::int AS "days30",
             (COUNT(*) FILTER (WHERE d."expiresAt" <= ${today}::date + 60))::int AS "days60",
             COUNT(*)::int AS "days90"
      FROM "Document" d
      WHERE d."deletedAt" IS NULL AND d."status" NOT IN ('VENCIDO', 'ANULADO')
        AND d."expiresAt" >= ${today}::date AND d."expiresAt" <= ${today}::date + 90`);
    return row ?? { days30: 0, days60: 0, days90: 0 };
  }

  async activityCounts(request: {
    filter: ActivityListCriteria;
    todayStart: Date;
    tomorrowStart: Date;
  }): Promise<ActivityCounts> {
    const count = async (where: Prisma.Sql): Promise<number> => {
      const [row] = await this.tx.db.$queryRaw<{ count: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "ActivityLog" a LEFT JOIN "User" u ON u."id" = a."actorId"
        WHERE ${where}`);
      return row?.count ?? 0;
    };
    const { filter, todayStart, tomorrowStart } = request;
    const [total, today, users] = await Promise.all([
      count(activityWhere(filter)),
      count(Prisma.sql`a."createdAt" >= ${todayStart} AND a."createdAt" < ${tomorrowStart}`),
      count(activityWhere({ ...filter, actorTypes: ['USER'] })),
    ]);
    return { total, today, users };
  }
}
