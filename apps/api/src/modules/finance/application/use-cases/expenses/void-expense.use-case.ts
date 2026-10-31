import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { EXPENSE_ERRORS } from '../../../domain/errors';
import type { ExpenseRecord } from '../../ports/expense.repository.port';
import { type ExpenseOutput, type ExpenseSupport, expenseLockSet } from './expense-support';
import { textError, throwIfAny } from '../../field-validation';

export interface VoidExpenseInput {
  readonly id: string;
  readonly reason?: string | null | undefined;
}

/**
 * `voidExpense`: `ANULADO` is final. A voided paid expense leaves the account balance and the project margin
 * in the same unit of work; its period, if it came from a recurring expense, is not generated again because
 * the row stays. The reason goes to the activity metadata (no column).
 */
export class VoidExpense {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: ExpenseSupport,
  ) {}

  async execute(actor: CurrentUser, input: VoidExpenseInput): Promise<ExpenseOutput> {
    assertCan(this.authorization, actor, 'update', 'expense');
    const errors = {};
    textError(errors, 'reason', input.reason, 500, false);
    throwIfAny(errors);

    await this.uow.run(
      async () => {
        const first = await this.support.expenses.findById(input.id);
        if (!first) throw new NotFoundError();
        await this.support.locks.lock(
          expenseLockSet({
            projectIds: [first.projectId],
            expenseIds: [input.id],
            accountIds: [first.accountId],
          }),
        );
        const before = await this.support.expenses.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.projectId !== first.projectId || before.accountId !== first.accountId) {
          throw new ConflictError();
        }
        if (before.status === 'ANULADO') {
          throw new ConflictError({ message: EXPENSE_ERRORS.voided });
        }
        const after: ExpenseRecord = {
          ...before,
          status: 'ANULADO',
          updatedAt: this.support.nowIso(),
        };
        const reason = input.reason?.trim();
        await this.support.persist(this.support.actorOf(actor), 'STATUS_CHANGE', before, after, {
          metadata: { from: before.status, to: 'ANULADO', ...(reason ? { reason } : {}) },
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}
