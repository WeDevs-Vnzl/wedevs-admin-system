import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import {
  FREQUENCY_VALUES,
  RECURRING_STATUS_VALUES,
  type Frequency,
  type RecurringStatus,
} from '../../../../../shared/domain/enums';
import type { ListQuery, SortSpec } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import { EXPENSE_ERRORS } from '../../../domain/errors';
import type {
  RecurringExpenseFilter,
  RecurringExpenseRecord,
  RecurringExpenseRepository,
} from '../../ports/expense-recurring.repository.port';
import {
  EXPENSE_MESSAGES,
  RECURRING_EXPENSE_SORT_FIELDS,
  type RecurringExpenseOutput,
  expenseLockSet,
  nextDueDateOf,
  todayOf,
} from './expense-support';
import { addError, throwIfAny } from '../../field-validation';
import {
  type RecurringExpenseInput,
  type RecurringExpenseSupport,
  recurringInputErrors,
} from './recurring-expense-support';

export const DEFAULT_RECURRING_EXPENSE_SORT: SortSpec = { field: 'name', direction: 'asc' };

const RECURRING_ACTIVITY_FIELDS = [
  'name',
  'vendor',
  'categoryId',
  'accountId',
  'projectId',
  'currency',
  'amount',
  'frequency',
  'dayOfPeriod',
  'leadDays',
  'startDate',
  'endDate',
] as const;

/**
 * `createRecurringExpense` (HU-17 CA1): a schedule that generates one pending expense per period. The USD
 * snapshot (`usdRate`, `monthlyAmountUsd`) is taken now (Δ10). It feeds no balance, fact or metric, so it is
 * just a row, a search-free activity entry and the `RecurringExpense` lock for the checks.
 */
export class CreateRecurringExpense {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: RecurringExpenseSupport,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: RecurringExpenseInput): Promise<RecurringExpenseOutput> {
    assertCan(this.authorization, actor, 'create', 'expense');
    throwIfAny(recurringInputErrors(input));

    const id = await this.uow.run(
      async () => {
        await this.support.locks.lock(
          expenseLockSet({ projectIds: [input.projectId], accountIds: [input.accountId] }),
        );
        await this.support.requireRefs(input);
        const snapshot = await this.support.snapshot(input);
        const record: RecurringExpenseRecord = {
          id: this.ids.next(),
          name: input.name.trim(),
          vendor: input.vendor?.trim() || null,
          categoryId: input.categoryId,
          accountId: input.accountId ?? null,
          projectId: input.projectId ?? null,
          currency: input.currency,
          ...snapshot,
          frequency: input.frequency,
          dayOfPeriod: input.dayOfPeriod,
          leadDays: input.leadDays,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          status: 'ACTIVO',
          lastGeneratedPeriodStart: null,
          resumedOn: null,
          createdAt: this.support.clock.now().toISOString(),
        };
        await this.support.recurring.insert(record);
        await this.support.activityLog.record({
          actor: actorOf(actor),
          action: 'CREATE',
          entityType: 'RECURRING_EXPENSE',
          entityId: record.id,
          entityLabel: record.name,
          metadata: { frequency: record.frequency },
        });
        return record.id;
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(id);
  }
}

/**
 * `updateRecurringExpense`: changing the amount affects only the periods not generated yet; generated
 * expenses keep their own amount (§9.2). The USD snapshot is taken again from the rate on the business day.
 * A finished schedule is final (`CONFLICT`).
 */
export class UpdateRecurringExpense {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: RecurringExpenseSupport,
  ) {}

  async execute(
    actor: CurrentUser,
    input: RecurringExpenseInput & { readonly id: string },
  ): Promise<RecurringExpenseOutput> {
    assertCan(this.authorization, actor, 'update', 'expense');
    throwIfAny(recurringInputErrors(input));

    await this.uow.run(
      async () => {
        const first = await this.support.recurring.findById(input.id);
        if (!first) throw new NotFoundError();
        await this.support.locks.lock(
          expenseLockSet({
            projectIds: [first.projectId, input.projectId],
            recurringIds: [input.id],
            accountIds: [input.accountId],
          }),
        );
        const before = await this.support.recurring.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.projectId !== first.projectId) throw new ConflictError();
        if (before.status === 'FINALIZADO') {
          throw new ConflictError({ message: EXPENSE_ERRORS.recurringFinished });
        }
        await this.support.requireRefs(input);
        const snapshot = await this.support.snapshot(input);
        const after: RecurringExpenseRecord = {
          ...before,
          name: input.name.trim(),
          vendor: input.vendor?.trim() || null,
          categoryId: input.categoryId,
          accountId: input.accountId ?? null,
          projectId: input.projectId ?? null,
          currency: input.currency,
          ...snapshot,
          frequency: input.frequency,
          dayOfPeriod: input.dayOfPeriod,
          leadDays: input.leadDays,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
        };
        await this.support.recurring.update(after);
        await this.support.activityLog.record({
          actor: actorOf(actor),
          action: 'UPDATE',
          entityType: 'RECURRING_EXPENSE',
          entityId: after.id,
          entityLabel: after.name,
          changes: diffFields({ ...before }, { ...after }, { fields: RECURRING_ACTIVITY_FIELDS }),
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}

export interface SetRecurringExpenseStatusInput {
  readonly id: string;
  readonly status: RecurringStatus;
}

/**
 * Pauses, resumes or finishes a schedule; a finished schedule is final. A resume stamps `resumedOn` with the
 * business day so the periods missed while paused are never back-filled (PRD §8.4.3, Q-BE3-2).
 */
export class SetRecurringExpenseStatus {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: RecurringExpenseSupport,
  ) {}

  async execute(
    actor: CurrentUser,
    input: SetRecurringExpenseStatusInput,
  ): Promise<RecurringExpenseOutput> {
    assertCan(this.authorization, actor, 'update', 'expense');
    if (!(RECURRING_STATUS_VALUES as readonly unknown[]).includes(input.status)) {
      const errors = {};
      addError(errors, 'status', EXPENSE_MESSAGES.invalidOption);
      throwIfAny(errors);
    }

    await this.uow.run(
      async () => {
        await this.support.locks.lock(expenseLockSet({ recurringIds: [input.id] }));
        const before = await this.support.recurring.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.status === input.status) return;
        if (before.status === 'FINALIZADO') {
          throw new ConflictError({ message: EXPENSE_ERRORS.recurringFinished });
        }
        const after: RecurringExpenseRecord = {
          ...before,
          status: input.status,
          resumedOn:
            before.status === 'PAUSADO' && input.status === 'ACTIVO'
              ? todayOf(this.support.clock)
              : before.resumedOn,
        };
        await this.support.recurring.update(after);
        await this.support.activityLog.record({
          actor: actorOf(actor),
          action: 'STATUS_CHANGE',
          entityType: 'RECURRING_EXPENSE',
          entityId: after.id,
          entityLabel: after.name,
          changes: { status: [before.status, after.status] },
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}

function many(query: ListQuery, name: string): string[] | undefined {
  const value = query.filters[name];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? [value] : [...value];
}

export function toRecurringFilter(query: ListQuery): RecurringExpenseFilter {
  const errors = {};
  const statuses = many(query, 'status');
  const frequencies = many(query, 'frequency');
  if (statuses?.some((value) => !(RECURRING_STATUS_VALUES as readonly string[]).includes(value))) {
    addError(errors, 'status', EXPENSE_MESSAGES.invalidOption);
  }
  if (frequencies?.some((value) => !(FREQUENCY_VALUES as readonly string[]).includes(value))) {
    addError(errors, 'frequency', EXPENSE_MESSAGES.invalidOption);
  }
  if (
    query.sort &&
    !(RECURRING_EXPENSE_SORT_FIELDS as readonly string[]).includes(query.sort.field)
  ) {
    addError(errors, 'sort', 'validation.sort.invalid');
  }
  throwIfAny(errors);
  const categoryId = many(query, 'categoryId');
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(statuses ? { status: statuses as RecurringStatus[] } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(frequencies ? { frequency: frequencies as Frequency[] } : {}),
    sort: query.sort ?? DEFAULT_RECURRING_EXPENSE_SORT,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export class ListRecurringExpenses {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly recurring: RecurringExpenseRepository,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<RecurringExpenseOutput>> {
    assertCan(this.authorization, actor, 'read', 'expense');
    const page = await this.recurring.list(toRecurringFilter(query));
    const periods = await this.recurring.periodsOf(page.items.map((row) => row.id));
    return {
      ...page,
      items: page.items.map((row) => ({
        ...row,
        nextDueDate: nextDueDateOf(row, periods.get(row.id) ?? []),
      })),
    };
  }
}

export class GetRecurringExpense {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly support: RecurringExpenseSupport,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<RecurringExpenseOutput> {
    assertCan(this.authorization, actor, 'read', 'expense');
    return this.support.output(id);
  }
}
