import { Inject, Injectable } from '@nestjs/common';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import { roundMoney } from '../../../shared/domain/money';
import { pageWindow, paginated, type Paginated } from '../../../shared/domain/pagination';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToString,
  stringToDecimal,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  ExpenseCategoryView,
  ExpenseFilter,
  ExpenseRecord,
  ExpenseRepository,
  ExpenseView,
} from '../application/ports/expense.repository.port';
import { EXPENSE_ERRORS } from '../domain/errors';
import {
  anyOf,
  dateBound,
  hasSearchText,
  orderBy,
  searchPage,
} from '../../../shared/infrastructure/prisma/search-entry-page';

const VIEW_INCLUDE = {
  category: { include: { parent: true } },
  account: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  recurring: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<object>;
type ExpenseViewRow = Prisma.ExpenseGetPayload<{ include: typeof VIEW_INCLUDE }>;

const optionalDate = (value: Date | null) => (value === null ? null : dbDateToDateOnly(value));
/** A `Decimal(18,2)` column as a two-decimal string (`toFixed()` alone would drop trailing zeros). */
export const money = (value: Prisma.Decimal): string => roundMoney(decimalToString(value));

function toRecord(row: ExpenseRow): ExpenseRecord {
  return {
    id: row.id,
    code: row.code,
    date: dbDateToDateOnly(row.date),
    dueDate: optionalDate(row.dueDate),
    paidAt: optionalDate(row.paidAt),
    description: row.description,
    vendor: row.vendor,
    categoryId: row.categoryId,
    accountId: row.accountId,
    projectId: row.projectId,
    currency: row.currency,
    amount: money(row.amount),
    accountAmount: row.accountAmount === null ? null : money(row.accountAmount),
    usdRate: decimalToString(row.usdRate),
    amountUsd: money(row.amountUsd),
    status: row.status,
    receiptFileId: row.receiptFileId,
    recurringExpenseId: row.recurringExpenseId,
    periodStart: optionalDate(row.periodStart),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
  };
}

export function toCategoryView(row: {
  id: string;
  name: string;
  nameEn: string | null;
  parent: { id: string; name: string; nameEn: string | null } | null;
}): ExpenseCategoryView {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    parent: row.parent
      ? { id: row.parent.id, name: row.parent.name, nameEn: row.parent.nameEn }
      : null,
  };
}

function toView(row: ExpenseViewRow): ExpenseView {
  return {
    ...toRecord(row),
    category: toCategoryView(row.category),
    account: row.account ? { type: 'ACCOUNT', id: row.account.id, label: row.account.name } : null,
    project: row.project
      ? { type: 'PROJECT', id: row.project.id, code: row.project.code, label: row.project.name }
      : null,
    recurringExpense: row.recurring
      ? { type: 'RECURRING_EXPENSE', id: row.recurring.id, label: row.recurring.name }
      : null,
  };
}

function data(record: ExpenseRecord) {
  return {
    code: record.code,
    date: dateOnlyToDbDate(record.date),
    dueDate: record.dueDate ? dateOnlyToDbDate(record.dueDate) : null,
    paidAt: record.paidAt ? dateOnlyToDbDate(record.paidAt) : null,
    description: record.description,
    vendor: record.vendor,
    categoryId: record.categoryId,
    accountId: record.accountId,
    projectId: record.projectId,
    currency: record.currency,
    amount: stringToDecimal(record.amount),
    accountAmount: record.accountAmount === null ? null : stringToDecimal(record.accountAmount),
    usdRate: stringToDecimal(record.usdRate),
    amountUsd: stringToDecimal(record.amountUsd),
    status: record.status,
    receiptFileId: record.receiptFileId,
    recurringExpenseId: record.recurringExpenseId,
    periodStart: record.periodStart ? dateOnlyToDbDate(record.periodStart) : null,
    createdById: record.createdById,
  };
}

/**
 * `Expense` rows through the current transaction. List labels join `ExpenseCategory` (settings), `Account`,
 * `Project` (commercial) and the tag assignments as read-only selects (DT-118). Expenses are never archived (Q-BE3-4), so no read filters `deletedAt`.
 */
@Injectable()
export class PrismaExpenseRepository implements ExpenseRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async findById(id: string): Promise<ExpenseRecord | null> {
    const row = await this.host.db.expense.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async insert(record: ExpenseRecord): Promise<void> {
    try {
      await this.host.db.expense.create({
        data: { id: record.id, ...data(record), createdAt: new Date(record.createdAt) },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  async update(record: ExpenseRecord): Promise<void> {
    try {
      await this.host.db.expense.update({
        where: { id: record.id },
        data: data(record),
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): unknown {
    if (isUniqueViolation(error, 'receiptFileId')) {
      return new ValidationFailedError({
        fieldErrors: { receiptFileId: [EXPENSE_ERRORS.receiptUnavailable] },
      });
    }
    return error;
  }

  async view(id: string): Promise<ExpenseView | null> {
    const row = await this.host.db.expense.findUnique({ where: { id }, include: VIEW_INCLUDE });
    return row ? toView(row) : null;
  }

  /** The filters of `list` as SQL conditions, for the search path (the page is selected by Postgres). */
  private conditions(filter: ExpenseFilter): Prisma.Sql[] {
    const sql: Prisma.Sql[] = [Prisma.sql`"deletedAt" IS NULL`];
    if (filter.status) sql.push(anyOf('status', filter.status));
    if (filter.categoryId) {
      const ids = [...filter.categoryId];
      sql.push(
        Prisma.sql`("categoryId" = ANY(${ids}::text[]) OR "categoryId" IN (SELECT c."id" FROM "ExpenseCategory" c WHERE c."parentId" = ANY(${ids}::text[])))`,
      );
    }
    if (filter.accountId) sql.push(anyOf('accountId', filter.accountId));
    if (filter.projectId) sql.push(anyOf('projectId', filter.projectId));
    if (filter.currency) sql.push(anyOf('currency', filter.currency));
    if (filter.tagId) {
      sql.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "TagAssignment" t WHERE t."expenseId" = "Expense"."id" AND t."tagId" = ANY(${[...filter.tagId]}::text[]))`,
      );
    }
    if (filter.dateFrom) sql.push(dateBound('date', '>=', dateOnlyToDbDate(filter.dateFrom)));
    if (filter.dateTo) sql.push(dateBound('date', '<=', dateOnlyToDbDate(filter.dateTo)));
    if (filter.recurringOnly) sql.push(Prisma.sql`"recurringExpenseId" IS NOT NULL`);
    return sql;
  }

  /** A list with a `q`: Postgres resolves it through `SearchEntry` and pages and counts the match. */
  private async searchList(filter: ExpenseFilter & { q: string }): Promise<Paginated<ExpenseView>> {
    const { skip, take } = pageWindow(filter.page, filter.pageSize);
    const { ids, total } = await searchPage(this.host.db, 'EXPENSE', filter.q, {
      table: 'Expense',
      conditions: this.conditions(filter),
      order: orderBy(filter.sort.field, filter.sort.direction),
      skip,
      take,
    });
    const rows = await this.host.db.expense.findMany({
      where: { id: { in: ids } },
      include: VIEW_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return paginated(
      ids.flatMap((id) => (byId.has(id) ? [toView(byId.get(id) as ExpenseViewRow)] : [])),
      total,
      filter,
    );
  }

  async list(filter: ExpenseFilter): Promise<Paginated<ExpenseView>> {
    if (hasSearchText(filter.q)) return this.searchList({ ...filter, q: filter.q });
    const and: Prisma.ExpenseWhereInput[] = [];
    if (filter.status) and.push({ status: { in: [...filter.status] } });
    if (filter.categoryId) {
      and.push({
        OR: [
          { categoryId: { in: [...filter.categoryId] } },
          { category: { parentId: { in: [...filter.categoryId] } } },
        ],
      });
    }
    if (filter.accountId) and.push({ accountId: { in: [...filter.accountId] } });
    if (filter.projectId) and.push({ projectId: { in: [...filter.projectId] } });
    if (filter.currency) and.push({ currency: { in: [...filter.currency] } });
    if (filter.tagId) and.push({ tags: { some: { tagId: { in: [...filter.tagId] } } } });
    if (filter.dateFrom) and.push({ date: { gte: dateOnlyToDbDate(filter.dateFrom) } });
    if (filter.dateTo) and.push({ date: { lte: dateOnlyToDbDate(filter.dateTo) } });
    if (filter.recurringOnly) and.push({ recurringExpenseId: { not: null } });
    const where: Prisma.ExpenseWhereInput = and.length > 0 ? { AND: and } : {};
    const { skip, take } = pageWindow(filter.page, filter.pageSize);
    const rows = await this.host.db.expense.findMany({
      where,
      include: VIEW_INCLUDE,
      orderBy: [{ [filter.sort.field]: filter.sort.direction }, { id: 'asc' }],
      skip,
      take,
    });
    const total = await this.host.db.expense.count({ where });
    return paginated(rows.map(toView), total, filter);
  }

  async labels(ids: readonly string[]) {
    const rows = await this.host.db.expense.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, description: true },
    });
    return new Map(rows.map((row) => [row.id, { code: row.code, description: row.description }]));
  }

  async hasReceiptFile(fileId: string): Promise<boolean> {
    const count = await this.host.db.expense.count({ where: { receiptFileId: fileId } });
    return count > 0;
  }
}
