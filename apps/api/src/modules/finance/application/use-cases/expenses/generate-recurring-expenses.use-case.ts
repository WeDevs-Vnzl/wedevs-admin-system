import type { Actor } from '../../../../../shared/application/actor';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../../../../shared/application/ports/search-index.port';
import type { SequencePort } from '../../../../../shared/application/ports/sequence.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { ForbiddenError } from '../../../../../shared/domain/domain-error';
import { roundMoney, toUsd } from '../../../../../shared/domain/money';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import type { ExpenseRepository, ExpenseRecord } from '../../ports/expense.repository.port';
import type { RecurringExpenseRepository } from '../../ports/expense-recurring.repository.port';
import {
  MAX_PERIODS_PER_RUN,
  expenseLockSet,
  expenseSearchEntry,
  nextOpenPeriod,
  todayOf,
} from './expense-support';

/** What the daily step created: `created` counts the periods, `periodStarts` lists them. */
export interface RecurringExpenseGenerationResult {
  readonly created: number;
  readonly periodStarts: DateOnly[];
}

/** The actor of the scheduled step (`SYSTEM_JOB`); `execute` refuses any other actor. */
export const GENERATION_ACTOR: Actor = { actorType: 'SYSTEM', userId: null };

/**
 * Step 4 of `daily-maintenance` (HU-17 CA1, no route; BE-5 schedules it): creates the pending expenses of every
 * active schedule that are due by the business day, catching up every missed period, never a period twice
 * (CA1) and never a voided one again. A paused or finished schedule generates nothing. A non-USD schedule
 * without a rate on the day waits for one. Each schedule runs in its own Serializable unit of work under its
 * `RecurringExpense` lock, so two concurrent runs create one expense per period; the unique
 * `(recurringExpenseId, periodStart)` is the backstop. Pending expenses feed no balance, fact or metric.
 */
export class GenerateRecurringExpenses {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly recurring: RecurringExpenseRepository,
    private readonly expenses: ExpenseRepository,
    private readonly rates: ExchangeRatePort,
    private readonly sequence: SequencePort,
    private readonly locks: RowLocksPort,
    private readonly search: SearchIndexPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: Actor): Promise<RecurringExpenseGenerationResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const periodStarts: DateOnly[] = [];
    const scheduleIds = await this.recurring.activeIds();
    for (const id of scheduleIds) {
      periodStarts.push(...(await this.generateFor(actor, id)));
    }
    return { created: periodStarts.length, periodStarts };
  }

  private generateFor(actor: Actor, id: string): Promise<DateOnly[]> {
    return this.uow.run(
      async () => {
        await this.locks.lock(expenseLockSet({ recurringIds: [id] }));
        const row = await this.recurring.findById(id);
        if (!row || row.status !== 'ACTIVO') return [];
        const today = todayOf(this.clock);
        const taken = [...((await this.recurring.periodsOf([id])).get(id) ?? [])];
        const created: DateOnly[] = [];
        for (let guard = 0; guard < MAX_PERIODS_PER_RUN; guard += 1) {
          const due = nextOpenPeriod(row, row.status, taken, today);
          if (!due) break;
          const selected = await this.rates.getRateFor(today, row.currency);
          if (!selected) break;
          const amount = roundMoney(row.amount);
          const now = this.clock.now().toISOString();
          const record: ExpenseRecord = {
            id: this.ids.next(),
            code: await this.sequence.next('GAS'),
            date: due.generateOn,
            dueDate: due.periodStart,
            paidAt: null,
            description: `${row.name} · ${due.periodStart}`,
            vendor: row.vendor,
            categoryId: row.categoryId,
            accountId: row.accountId,
            projectId: row.projectId,
            currency: row.currency,
            amount,
            accountAmount: null,
            usdRate: selected.usdRate,
            amountUsd: toUsd(amount, selected.usdRate),
            status: 'PENDIENTE',
            receiptFileId: null,
            recurringExpenseId: row.id,
            periodStart: due.periodStart,
            createdAt: now,
            updatedAt: now,
            createdById: null,
          };
          await this.expenses.insert(record);
          await this.search.upsert(expenseSearchEntry(record));
          taken.push(due.periodStart);
          created.push(due.periodStart);
        }
        if (created.length === 0) return [];
        const last = [...taken].sort().at(-1) ?? null;
        await this.recurring.update({ ...row, lastGeneratedPeriodStart: last });
        await this.activityLog.record({
          actor,
          action: 'SYSTEM_JOB',
          entityType: 'RECURRING_EXPENSE',
          entityId: row.id,
          entityLabel: row.name,
          metadata: { created: created.length },
        });
        return created;
      },
      { isolation: 'Serializable' },
    );
  }
}
