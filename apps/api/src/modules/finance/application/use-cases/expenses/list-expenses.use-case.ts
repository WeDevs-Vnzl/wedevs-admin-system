import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import { EXPENSE_STATUS_VALUES, type ExpenseStatus } from '../../../../../shared/domain/enums';
import type { ListQuery, SortSpec } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import type { ExpenseFilter, ExpenseRepository } from '../../ports/expense.repository.port';
import {
  type ExpenseOutput,
  toExpenseOutput,
  todayOf,
  EXPENSE_SORT_FIELDS,
} from './expense-support';
import { dateError, throwIfAny, addError } from '../../field-validation';

export const DEFAULT_EXPENSE_SORT: SortSpec = { field: 'date', direction: 'desc' };

function many(query: ListQuery, name: string): string[] | undefined {
  const value = query.filters[name];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? [value] : [...value];
}

/** Maps the list query of the route to the repository filter, repeating the checks the DTO makes. */
export function toExpenseFilter(query: ListQuery): ExpenseFilter {
  const errors = {};
  const statuses = many(query, 'status');
  const dateFrom = many(query, 'dateFrom')?.[0];
  const dateTo = many(query, 'dateTo')?.[0];
  if (dateFrom !== undefined) dateError(errors, 'dateFrom', dateFrom);
  if (dateTo !== undefined) dateError(errors, 'dateTo', dateTo);
  if (statuses?.some((value) => !(EXPENSE_STATUS_VALUES as readonly string[]).includes(value))) {
    addError(errors, 'status', 'validation.invalidOption');
  }
  if (query.sort && !(EXPENSE_SORT_FIELDS as readonly string[]).includes(query.sort.field)) {
    addError(errors, 'sort', 'validation.sort.invalid');
  }
  throwIfAny(errors);
  const recurringOnly = many(query, 'recurringOnly')?.[0];
  const categoryId = many(query, 'categoryId');
  const accountId = many(query, 'accountId');
  const projectId = many(query, 'projectId');
  const currency = many(query, 'currency');
  const tagId = many(query, 'tagId');
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(statuses ? { status: statuses as ExpenseStatus[] } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(currency ? { currency } : {}),
    ...(tagId ? { tagId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(recurringOnly === 'true' ? { recurringOnly: true } : {}),
    sort: query.sort ?? DEFAULT_EXPENSE_SORT,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * The expense table (DT-25): voided ones included so they stay visible. `can(read, expense)` first (Owner and
 * Admin, PRD §4.3); every filter is optional and they combine with AND.
 */
export class ListExpenses {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly expenses: ExpenseRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<ExpenseOutput>> {
    assertCan(this.authorization, actor, 'read', 'expense');
    const page = await this.expenses.list(toExpenseFilter(query));
    const today = todayOf(this.clock);
    return { ...page, items: page.items.map((view) => toExpenseOutput(view, today)) };
  }
}

export class GetExpense {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly expenses: ExpenseRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<ExpenseOutput> {
    assertCan(this.authorization, actor, 'read', 'expense');
    const view = await this.expenses.view(id);
    if (!view) throw new NotFoundError();
    return toExpenseOutput(view, todayOf(this.clock));
  }
}
