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
import type { AccountMovementType } from '../../../../../shared/domain/enums';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import {
  isZeroMoney,
  roundMoney,
  toUsd,
  type MoneyString,
} from '../../../../../shared/domain/money';
import type { FinanceProjector } from '../../finance-projector';
import type { AccountPartnersPort } from '../../ports/account-partners.port';
import type { AccountRepository, MovementRecord } from '../../ports/account.repository.port';
import {
  ACCOUNT_MESSAGES,
  addErrors,
  amountErrors,
  dateErrors,
  rateErrors,
  requiredTextErrors,
  usdRateErrors,
} from './account-support';

export interface CreateMovementInput {
  readonly accountId: string;
  readonly type: AccountMovementType;
  readonly date: DateOnly;
  /** A positive magnitude for contributions and withdrawals; signed and non-zero for `AJUSTE`. */
  readonly amount: MoneyString;
  /** Account-currency rate to USD of the day, for the USD snapshot (PRD §9.2). */
  readonly usdRate: MoneyString;
  /** The partner (a user) behind a contribution or withdrawal; ignored for `AJUSTE`. */
  readonly partnerId?: string | null;
  readonly description: string;
}

export interface MovementOutput extends MovementRecord {
  readonly account: EntityRef;
  readonly partner: EntityRef | null;
}

const TYPES: readonly AccountMovementType[] = ['APORTE_CAPITAL', 'RETIRO_SOCIO', 'AJUSTE'];

/**
 * Manual movement: a contribution, a withdrawal (positive amounts, the type gives the sign, DT-106) or a
 * signed non-zero `AJUSTE`. `can(create, account)` → validate (lesson B2: positive amount, non-zero
 * adjustment, partner required for contributions and withdrawals) → one `Serializable` unit of work that locks
 * the `Account` row first, checks it is live and active and the partner exists, stores the USD snapshot at
 * write time (C16), projects the movement fact and the cached balance and logs.
 */
export class CreateMovement {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly locks: RowLocksPort,
    private readonly accounts: AccountRepository,
    private readonly partners: AccountPartnersPort,
    private readonly projector: FinanceProjector,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateMovementInput): Promise<MovementOutput> {
    assertCan(this.authorization, actor, 'create', 'account');
    const errors: FieldErrors = {};
    const isAdjustment = input.type === 'AJUSTE';
    if (!TYPES.includes(input.type)) addErrors(errors, 'type', [ACCOUNT_MESSAGES.invalidType]);
    addErrors(errors, 'date', dateErrors(input.date));
    addErrors(errors, 'amount', amountErrors(input.amount, isAdjustment ? 'any' : 'positive'));
    if (isAdjustment && errors.amount === undefined && isZeroMoney(roundMoney(input.amount))) {
      addErrors(errors, 'amount', [ACCOUNT_MESSAGES.adjustmentNonZero]);
    }
    addErrors(errors, 'usdRate', rateErrors(input.usdRate));
    addErrors(errors, 'description', requiredTextErrors(input.description, 200));
    if (!isAdjustment && !input.partnerId) {
      addErrors(errors, 'partnerId', [ACCOUNT_MESSAGES.partnerRequired]);
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

    const id = this.ids.next();
    const createdAt = this.clock.now().toISOString();
    return this.uow.run(
      async () => {
        await this.locks.lock({ Account: [input.accountId] });
        const account = await this.accounts.find(input.accountId);
        if (!account) throw new NotFoundError();
        const problems: FieldErrors = {};
        if (!account.active) addErrors(problems, 'accountId', [ACCOUNT_MESSAGES.inactive]);
        addErrors(problems, 'usdRate', usdRateErrors(input.usdRate, account.currency));
        const partner =
          !isAdjustment && input.partnerId ? await this.partners.find(input.partnerId) : null;
        if (!isAdjustment && partner === null) {
          addErrors(problems, 'partnerId', [ACCOUNT_MESSAGES.partnerRequired]);
        }
        if (Object.keys(problems).length > 0) {
          throw new ValidationFailedError({ fieldErrors: problems });
        }
        const amount = roundMoney(input.amount);
        const record: MovementRecord = {
          id,
          accountId: account.id,
          type: input.type,
          date: input.date,
          amount,
          amountUsd: toUsd(amount, input.usdRate),
          partnerId: partner?.id ?? null,
          description: input.description.trim(),
          createdAt,
          createdById: actor.userId,
        };
        await this.accounts.insertMovement(record);
        await this.projector.projectMovement(id);
        await this.projector.projectAccount(account.id);
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'CREATE',
          entityType: 'ACCOUNT_MOVEMENT',
          entityId: id,
          entityLabel: account.name,
        });
        return {
          ...record,
          account: { type: 'ACCOUNT', id: account.id, label: account.name },
          partner: partner && { type: 'USER', id: partner.id, label: partner.name },
        };
      },
      { isolation: 'Serializable' },
    );
  }
}
