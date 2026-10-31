import { Inject, Injectable } from '@nestjs/common';
import { pageWindow, paginated, type Paginated } from '../../../shared/domain/pagination';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToString,
  stringToDecimal,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  RecurringExpenseFilter,
  RecurringExpenseRecord,
  RecurringExpenseRepository,
  RecurringExpenseView,
} from '../application/ports/expense-recurring.repository.port';
import { money, toCategoryView } from './prisma-expense.repository';

const VIEW_INCLUDE = {
  category: { include: { parent: true } },
  account: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.RecurringExpenseInclude;

type RecurringRow = Prisma.RecurringExpenseGetPayload<object>;
type RecurringViewRow = Prisma.RecurringExpenseGetPayload<{ include: typeof VIEW_INCLUDE }>;

const optionalDate = (value: Date | null) => (value === null ? null : dbDateToDateOnly(value));

function toRecord(row: RecurringRow): RecurringExpenseRecord {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    categoryId: row.categoryId,
    accountId: row.accountId,
    projectId: row.projectId,
    currency: row.currency,
    amount: money(row.amount),
    frequency: row.frequency,
    dayOfPeriod: row.dayOfPeriod,
    leadDays: row.leadDays,
    startDate: dbDateToDateOnly(row.startDate),
    endDate: optionalDate(row.endDate),
    status: row.status,
    lastGeneratedPeriodStart: optionalDate(row.lastGeneratedPeriodStart),
    resumedOn: optionalDate(row.resumedOn),
    usdRate: decimalToString(row.usdRate),
    monthlyAmountUsd: money(row.monthlyAmountUsd),
    createdAt: row.createdAt.toISOString(),
  };
}

function toView(row: RecurringViewRow): RecurringExpenseView {
  return {
    ...toRecord(row),
    category: toCategoryView(row.category),
    account: row.account ? { type: 'ACCOUNT', id: row.account.id, label: row.account.name } : null,
    project: row.project
      ? { type: 'PROJECT', id: row.project.id, code: row.project.code, label: row.project.name }
      : null,
  };
}

function data(record: RecurringExpenseRecord) {
  return {
    name: record.name,
    vendor: record.vendor,
    categoryId: record.categoryId,
    accountId: record.accountId,
    projectId: record.projectId,
    currency: record.currency,
    amount: stringToDecimal(record.amount),
    frequency: record.frequency,
    dayOfPeriod: record.dayOfPeriod,
    leadDays: record.leadDays,
    startDate: dateOnlyToDbDate(record.startDate),
    endDate: record.endDate ? dateOnlyToDbDate(record.endDate) : null,
    status: record.status,
    lastGeneratedPeriodStart: record.lastGeneratedPeriodStart
      ? dateOnlyToDbDate(record.lastGeneratedPeriodStart)
      : null,
    resumedOn: record.resumedOn ? dateOnlyToDbDate(record.resumedOn) : null,
    usdRate: stringToDecimal(record.usdRate),
    monthlyAmountUsd: stringToDecimal(record.monthlyAmountUsd),
  };
}

const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

/** `RecurringExpense` rows through the current transaction. Schedules are never archived (Q-BE3-4). */
@Injectable()
export class PrismaExpenseRecurringRepository implements RecurringExpenseRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async findById(id: string): Promise<RecurringExpenseRecord | null> {
    const row = await this.host.db.recurringExpense.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async insert(record: RecurringExpenseRecord): Promise<void> {
    await this.host.db.recurringExpense.create({
      data: { id: record.id, ...data(record), createdAt: new Date(record.createdAt) },
    });
  }

  async update(record: RecurringExpenseRecord): Promise<void> {
    await this.host.db.recurringExpense.update({ where: { id: record.id }, data: data(record) });
  }

  async view(id: string): Promise<RecurringExpenseView | null> {
    const row = await this.host.db.recurringExpense.findUnique({
      where: { id },
      include: VIEW_INCLUDE,
    });
    return row ? toView(row) : null;
  }

  async list(filter: RecurringExpenseFilter): Promise<Paginated<RecurringExpenseView>> {
    const and: Prisma.RecurringExpenseWhereInput[] = [];
    if (filter.status) and.push({ status: { in: [...filter.status] } });
    if (filter.frequency) and.push({ frequency: { in: [...filter.frequency] } });
    if (filter.categoryId) {
      and.push({
        OR: [
          { categoryId: { in: [...filter.categoryId] } },
          { category: { parentId: { in: [...filter.categoryId] } } },
        ],
      });
    }
    if (filter.q) {
      and.push({
        OR: [
          { name: contains(filter.q) },
          { vendor: contains(filter.q) },
          { category: { name: contains(filter.q) } },
        ],
      });
    }
    const where: Prisma.RecurringExpenseWhereInput = and.length > 0 ? { AND: and } : {};
    const { skip, take } = pageWindow(filter.page, filter.pageSize);
    const rows = await this.host.db.recurringExpense.findMany({
      where,
      include: VIEW_INCLUDE,
      orderBy: [{ [filter.sort.field]: filter.sort.direction }, { id: 'asc' }],
      skip,
      take,
    });
    const total = await this.host.db.recurringExpense.count({ where });
    return paginated(rows.map(toView), total, filter);
  }

  async activeIds(): Promise<string[]> {
    const rows = await this.host.db.recurringExpense.findMany({
      where: { status: 'ACTIVO' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  async periodsOf(ids: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    const rows = await this.host.db.expense.findMany({
      where: { recurringExpenseId: { in: [...ids] }, periodStart: { not: null } },
      select: { recurringExpenseId: true, periodStart: true },
    });
    for (const row of rows) {
      const list = row.recurringExpenseId ? out.get(row.recurringExpenseId) : undefined;
      if (list && row.periodStart) list.push(dbDateToDateOnly(row.periodStart));
    }
    return out;
  }
}
