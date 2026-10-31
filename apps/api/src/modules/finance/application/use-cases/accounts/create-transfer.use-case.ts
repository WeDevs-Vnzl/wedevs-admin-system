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
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import { roundMoney, toUsd, type MoneyString } from '../../../../../shared/domain/money';
import { transferProblem } from '../../../domain/accounts';
import type { FinanceProjector } from '../../finance-projector';
import type {
  AccountRecord,
  AccountRepository,
  TransferRecord,
} from '../../ports/account.repository.port';
import {
  ACCOUNT_MESSAGES,
  addErrors,
  amountErrors,
  dateErrors,
  optionalTextErrors,
  rateErrors,
  textOrNull,
  usdRateErrors,
} from './account-support';

export interface CreateTransferInput {
  readonly date: DateOnly;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** Debited from the origin account (the fee is debited on top). */
  readonly amountFrom: MoneyString;
  /** Credited to the destination account, in its own currency. */
  readonly amountTo: MoneyString;
  readonly feeAmount?: MoneyString;
  /** Cross rate between the two currencies, kept as information when they differ. */
  readonly rate?: MoneyString | null;
  /** Origin-currency rate to USD of the day, for the USD snapshot (PRD §9.2). */
  readonly usdRate: MoneyString;
  readonly reference?: string | null;
  readonly notes?: string | null;
}

export interface TransferOutput extends TransferRecord {
  readonly fromAccount: EntityRef;
  readonly toAccount: EntityRef;
}

const refOf = (account: AccountRecord): EntityRef => ({
  type: 'ACCOUNT',
  id: account.id,
  label: account.name,
});

/**
 * Transfer between two accounts (HU-16, §9.7): debits `amountFrom` plus the fee from the origin and credits
 * `amountTo` (already in the destination currency) to the destination. `can(create, account)` → validate (an
 * account cannot transfer to itself, HU-16 CA2) → one `Serializable` unit of work that locks both `Account`
 * rows up front (ascending, so A→B and B→A cannot deadlock), checks both are live and active, stores the USD
 * snapshot at write time (C16), projects the transfer facts and both cached balances and logs.
 */
export class CreateTransfer {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly locks: RowLocksPort,
    private readonly accounts: AccountRepository,
    private readonly projector: FinanceProjector,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateTransferInput): Promise<TransferOutput> {
    assertCan(this.authorization, actor, 'create', 'account');
    const feeAmount = input.feeAmount ?? '0';
    const errors: FieldErrors = {};
    addErrors(errors, 'date', dateErrors(input.date));
    addErrors(errors, 'amountFrom', amountErrors(input.amountFrom, 'positive'));
    addErrors(errors, 'amountTo', amountErrors(input.amountTo, 'positive'));
    addErrors(errors, 'feeAmount', amountErrors(feeAmount, 'nonNegative'));
    addErrors(errors, 'usdRate', rateErrors(input.usdRate));
    if (input.rate !== undefined && input.rate !== null) {
      addErrors(errors, 'rate', rateErrors(input.rate));
    }
    addErrors(errors, 'reference', optionalTextErrors(input.reference, 80));
    addErrors(errors, 'notes', optionalTextErrors(input.notes, 500));
    if (transferProblem(input.fromAccountId, input.toAccountId)) {
      addErrors(errors, 'toAccountId', [ACCOUNT_MESSAGES.sameAccount]);
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

    const id = this.ids.next();
    const createdAt = this.clock.now().toISOString();
    return this.uow.run(
      async () => {
        await this.locks.lock({ Account: [input.fromAccountId, input.toAccountId] });
        const from = await this.accounts.find(input.fromAccountId);
        const to = await this.accounts.find(input.toAccountId);
        if (!from || !to) throw new NotFoundError();
        const problems: FieldErrors = {};
        if (!from.active) addErrors(problems, 'fromAccountId', [ACCOUNT_MESSAGES.inactive]);
        if (!to.active) addErrors(problems, 'toAccountId', [ACCOUNT_MESSAGES.inactive]);
        addErrors(problems, 'usdRate', usdRateErrors(input.usdRate, from.currency));
        if (Object.keys(problems).length > 0) {
          throw new ValidationFailedError({ fieldErrors: problems });
        }
        const amountFrom = roundMoney(input.amountFrom);
        const record: TransferRecord = {
          id,
          date: input.date,
          fromAccountId: from.id,
          toAccountId: to.id,
          amountFrom,
          amountTo: roundMoney(input.amountTo),
          feeAmount: roundMoney(feeAmount),
          rate: input.rate ?? null,
          amountUsd: toUsd(amountFrom, input.usdRate),
          reference: textOrNull(input.reference),
          notes: textOrNull(input.notes),
          createdAt,
          createdById: actor.userId,
        };
        await this.accounts.insertTransfer(record);
        await this.projector.projectTransfer(id);
        for (const accountId of [from.id, to.id].sort()) {
          await this.projector.projectAccount(accountId);
        }
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'CREATE',
          entityType: 'TRANSFER',
          entityId: id,
          entityLabel: `${from.name} → ${to.name}`,
        });
        return { ...record, fromAccount: refOf(from), toAccount: refOf(to) };
      },
      { isolation: 'Serializable' },
    );
  }
}
