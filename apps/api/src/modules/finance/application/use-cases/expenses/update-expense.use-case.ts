import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { roundMoney, toUsd } from '../../../../../shared/domain/money';
import { EXPENSE_ERRORS } from '../../../domain/errors';
import type { ExpenseRecord } from '../../ports/expense.repository.port';
import type { CreateExpenseInput } from './create-expense.use-case';
import { expenseInputErrors } from './create-expense.use-case';
import {
  EXPENSE_ACTIVITY_FIELDS,
  type ExpenseOutput,
  type ExpenseSupport,
  expenseLockSet,
  storedAccountAmount,
} from './expense-support';
import { throwIfAny } from '../../field-validation';

/** Everything `createExpense` takes except the status and payment date: paying goes through `markExpensePaid`. */
export type UpdateExpenseInput = Omit<CreateExpenseInput, 'status' | 'paidAt'> & {
  readonly id: string;
};

/**
 * `updateExpense` (Q-BE3-3): edits a `PENDIENTE` expense only (`CONFLICT` otherwise, like `markExpensePaid`).
 * A pending expense feeds no balance, margin or fact, so nothing is projected beyond clearing its facts. The
 * project (old and new) and the account are locked up front; the row is read before the lock only to learn
 * the project, and read again under it.
 */
export class UpdateExpense {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: ExpenseSupport,
  ) {}

  async execute(actor: CurrentUser, input: UpdateExpenseInput): Promise<ExpenseOutput> {
    assertCan(this.authorization, actor, 'update', 'expense');
    throwIfAny(expenseInputErrors(input));

    await this.uow.run(
      async () => {
        const first = await this.support.expenses.findById(input.id);
        if (!first) throw new NotFoundError();
        await this.support.locks.lock(
          expenseLockSet({
            projectIds: [first.projectId, input.projectId],
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

        await this.support.requireCategory(input.categoryId);
        const account = input.accountId ? await this.support.requireAccount(input.accountId) : null;
        if (input.projectId) await this.support.requireProject(input.projectId);
        if (input.receiptFileId !== before.receiptFileId) {
          await this.support.reserveReceipt(actor, input.receiptFileId);
        }

        const amount = roundMoney(input.amount);
        const after: ExpenseRecord = {
          ...before,
          date: input.date,
          dueDate: input.dueDate ?? null,
          description: input.description.trim(),
          vendor: input.vendor?.trim() || null,
          categoryId: input.categoryId,
          accountId: input.accountId ?? null,
          projectId: input.projectId ?? null,
          currency: input.currency,
          amount,
          accountAmount: storedAccountAmount(input.currency, account, input.accountAmount),
          usdRate: input.usdRate,
          amountUsd: toUsd(amount, input.usdRate),
          receiptFileId: input.receiptFileId ?? null,
          updatedAt: this.support.nowIso(),
        };
        const changes = diffFields(
          { ...before },
          { ...after },
          {
            fields: EXPENSE_ACTIVITY_FIELDS,
            longText: ['description'],
          },
        );
        await this.support.persist(this.support.actorOf(actor), 'UPDATE', before, after, {
          changes,
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}
