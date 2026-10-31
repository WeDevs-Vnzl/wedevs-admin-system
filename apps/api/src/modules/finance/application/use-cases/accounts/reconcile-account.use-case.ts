import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import {
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import { roundMoney, type MoneyString } from '../../../../../shared/domain/money';
import { accountBalance, reconciliationAdjustment } from '../../../domain/accounts';
import type { AccountRepository } from '../../ports/account.repository.port';
import type { FinanceSourcesPort } from '../../ports/finance-sources.port';
import {
  addErrors,
  amountErrors,
  dateErrors,
  optionalTextErrors,
  textOrNull,
} from './account-support';

export interface ReconcileAccountInput {
  readonly date: DateOnly;
  readonly statementBalance: MoneyString;
  readonly notes?: string | null;
}

export interface ReconciliationOutput {
  readonly id: string;
  readonly accountId: string;
  readonly date: DateOnly;
  readonly statementBalance: MoneyString;
  readonly systemBalance: MoneyString;
  /** `statementBalance − systemBalance`; `"0.00"` when they match. */
  readonly difference: MoneyString;
  /** Signed `AJUSTE` that closes the difference; `null` when there is none. The user records it apart. */
  readonly suggestedAdjustment: MoneyString | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

/**
 * Reconciliation (HU-15 CA3, Q-BE3-5): compares the statement balance with the system balance at `date`,
 * stores the comparison and suggests the `AJUSTE`. It never changes the balance: the adjustment is a separate
 * `createMovement` the user decides. Locks the account so the system balance is the committed one.
 */
export class ReconcileAccount {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly locks: RowLocksPort,
    private readonly accounts: AccountRepository,
    private readonly sources: FinanceSourcesPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(
    actor: CurrentUser,
    accountId: string,
    input: ReconcileAccountInput,
  ): Promise<ReconciliationOutput> {
    assertCan(this.authorization, actor, 'update', 'account');
    const errors: FieldErrors = {};
    addErrors(errors, 'date', dateErrors(input.date));
    addErrors(errors, 'statementBalance', amountErrors(input.statementBalance, 'any'));
    addErrors(errors, 'notes', optionalTextErrors(input.notes, 500));
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

    const id = this.ids.next();
    const createdAt = this.clock.now().toISOString();
    return this.uow.run(
      async () => {
        await this.locks.lock({ Account: [accountId] });
        const account = await this.accounts.find(accountId);
        const source = account ? await this.sources.accountSource(accountId) : null;
        if (!account || !source) throw new NotFoundError();
        const systemBalance = accountBalance(source.activity, input.date);
        const statementBalance = roundMoney(input.statementBalance);
        const suggestedAdjustment = reconciliationAdjustment(systemBalance, statementBalance);
        const difference = suggestedAdjustment ?? '0.00';
        const notes = textOrNull(input.notes);
        await this.accounts.insertReconciliation({
          id,
          accountId,
          date: input.date,
          statementBalance,
          systemBalance,
          difference,
          notes,
          createdAt,
          createdById: actor.userId,
        });
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'CREATE',
          entityType: 'ACCOUNT',
          entityId: accountId,
          entityLabel: account.name,
          metadata: { reconciliationId: id, date: input.date, difference },
        });
        return {
          id,
          accountId,
          date: input.date,
          statementBalance,
          systemBalance,
          difference,
          suggestedAdjustment,
          notes,
          createdAt,
        };
      },
      { isolation: 'Serializable' },
    );
  }
}
