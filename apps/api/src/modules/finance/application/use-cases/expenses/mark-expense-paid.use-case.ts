import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { roundMoney, toUsd } from '../../../../../shared/domain/money';
import { EXPENSE_ERRORS } from '../../../domain/errors';
import type { ExpenseRecord } from '../../ports/expense.repository.port';
import {
  type ExpenseOutput,
  type ExpenseSupport,
  checkAccountAmount,
  expenseLockSet,
  storedAccountAmount,
} from './expense-support';
import { dateError, moneyError, throwIfAny, usdRateError } from '../../field-validation';

export interface MarkExpensePaidInput {
  readonly id: string;
  readonly accountId: string;
  readonly paidAt: DateOnly;
  readonly currency: string;
  readonly amount: string;
  readonly accountAmount?: string | null | undefined;
  readonly usdRate: string;
  readonly receiptFileId?: string | null | undefined;
}

/**
 * `markExpensePaid` (HU-17 CA2): confirms a pending expense. The account is mandatory; the real amount and rate
 * may differ from the estimate and the USD snapshot is taken again from them (§9.2). A voided or paid expense
 * is not marked again: two concurrent calls leave one `CONFLICT` and one debit, because the expense row lock
 * serializes them and the loser reads the committed `PAGADO`. The balance and the margin are recomputed in
 * the same unit of work (C12, C18).
 */
export class MarkExpensePaid {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: ExpenseSupport,
  ) {}

  async execute(actor: CurrentUser, input: MarkExpensePaidInput): Promise<ExpenseOutput> {
    assertCan(this.authorization, actor, 'update', 'expense');
    const errors = {};
    dateError(errors, 'paidAt', input.paidAt);
    moneyError(errors, 'amount', input.amount);
    if (input.accountAmount !== undefined && input.accountAmount !== null) {
      moneyError(errors, 'accountAmount', input.accountAmount);
    }
    usdRateError(errors, input.currency, input.usdRate);
    throwIfAny(errors);

    await this.uow.run(
      async () => {
        const first = await this.support.expenses.findById(input.id);
        if (!first) throw new NotFoundError();
        await this.support.locks.lock(
          expenseLockSet({
            projectIds: [first.projectId],
            expenseIds: [input.id],
            accountIds: [input.accountId],
          }),
        );
        const before = await this.support.expenses.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.projectId !== first.projectId) throw new ConflictError();
        if (before.status === 'ANULADO') {
          throw new ConflictError({ message: EXPENSE_ERRORS.voided });
        }
        if (before.status !== 'PENDIENTE') {
          throw new ConflictError({ message: EXPENSE_ERRORS.notPending });
        }

        const account = await this.support.requireAccount(input.accountId);
        checkAccountAmount(input.currency, account.currency, input.accountAmount);
        if (input.receiptFileId !== before.receiptFileId) {
          await this.support.reserveReceipt(actor, input.receiptFileId);
        }

        const amount = roundMoney(input.amount);
        const after: ExpenseRecord = {
          ...before,
          status: 'PAGADO',
          accountId: input.accountId,
          paidAt: input.paidAt,
          currency: input.currency,
          amount,
          amountUsd: toUsd(amount, input.usdRate),
          usdRate: input.usdRate,
          accountAmount: storedAccountAmount(input.currency, account, input.accountAmount),
          receiptFileId: input.receiptFileId ?? null,
          updatedAt: this.support.nowIso(),
        };
        await this.support.persist(this.support.actorOf(actor), 'STATUS_CHANGE', before, after, {
          metadata: { from: before.status, to: 'PAGADO' },
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}
