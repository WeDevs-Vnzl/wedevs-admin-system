import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { SequencePort } from '../../../../../shared/application/ports/sequence.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import type { FieldErrors } from '../../../../../shared/domain/domain-error';
import { roundMoney, toUsd } from '../../../../../shared/domain/money';
import type { ExpenseRecord } from '../../ports/expense.repository.port';
import {
  EXPENSE_MESSAGES,
  type ExpenseOutput,
  type ExpenseSupport,
  checkAccountAmount,
  expenseLockSet,
  storedAccountAmount,
} from './expense-support';
import {
  addError,
  dateError,
  moneyError,
  textError,
  throwIfAny,
  usdRateError,
} from '../../field-validation';

export interface CreateExpenseInput {
  readonly date: DateOnly;
  readonly dueDate?: DateOnly | null | undefined;
  readonly description: string;
  readonly vendor?: string | null | undefined;
  readonly categoryId: string;
  /** Required to create the expense as paid. */
  readonly accountId?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly currency: string;
  readonly amount: string;
  /** Amount debited in the account currency, when it differs from `currency` (§9.7). */
  readonly accountAmount?: string | null | undefined;
  readonly usdRate: string;
  readonly status: 'PENDIENTE' | 'PAGADO';
  /** Payment date; defaults to `date` when the expense is created as paid. */
  readonly paidAt?: DateOnly | null | undefined;
  readonly receiptFileId?: string | null | undefined;
}

/** The field rules shared by create and update; the DTO repeats them but the use case never relies on it. */
export function expenseInputErrors(input: {
  date: unknown;
  dueDate?: unknown;
  description: unknown;
  vendor?: unknown;
  currency: string;
  amount: unknown;
  accountAmount?: unknown;
  usdRate: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const dateOk = dateError(errors, 'date', input.date);
  if (input.dueDate !== undefined && input.dueDate !== null) {
    if (
      dateError(errors, 'dueDate', input.dueDate) &&
      dateOk &&
      input.dueDate < (input.date as string)
    ) {
      addError(errors, 'dueDate', EXPENSE_MESSAGES.dueBeforeDate);
    }
  }
  textError(errors, 'description', input.description, 300, true);
  textError(errors, 'vendor', input.vendor, 120, false);
  moneyError(errors, 'amount', input.amount);
  if (input.accountAmount !== undefined && input.accountAmount !== null) {
    moneyError(errors, 'accountAmount', input.accountAmount);
  }
  usdRateError(errors, input.currency, input.usdRate);
  return errors;
}

/**
 * `createExpense` (PRD §8.8, HU-17 CA2): an expense, pending or already paid. A paid one needs its account and,
 * for a foreign-currency debit, the amount debited in the account currency (§9.7). The USD snapshot is taken
 * from the rate given (§9.2). `can(create, expense)` → shape → Serializable unit of work: locks (project,
 * account) → references → receipt → insert → facts, balance and project margin → search → activity.
 */
export class CreateExpense {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: ExpenseSupport,
    private readonly sequence: SequencePort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateExpenseInput): Promise<ExpenseOutput> {
    assertCan(this.authorization, actor, 'create', 'expense');
    const errors = expenseInputErrors(input);
    if (input.status !== 'PENDIENTE' && input.status !== 'PAGADO') {
      addError(errors, 'status', EXPENSE_MESSAGES.invalidOption);
    }
    if (input.status === 'PAGADO' && !input.accountId) {
      addError(errors, 'accountId', EXPENSE_MESSAGES.accountRequiredForPaid);
    }
    if (input.paidAt !== undefined && input.paidAt !== null) {
      dateError(errors, 'paidAt', input.paidAt);
    }
    throwIfAny(errors);

    const id = await this.uow.run(
      async () => {
        await this.support.locks.lock(
          expenseLockSet({ projectIds: [input.projectId], accountIds: [input.accountId] }),
        );
        await this.support.requireCategory(input.categoryId);
        const account = input.accountId ? await this.support.requireAccount(input.accountId) : null;
        if (input.status === 'PAGADO' && account) {
          checkAccountAmount(input.currency, account.currency, input.accountAmount);
        }
        if (input.projectId) await this.support.requireProject(input.projectId);
        await this.support.reserveReceipt(actor, input.receiptFileId);

        const amount = roundMoney(input.amount);
        const now = this.support.nowIso();
        const record: ExpenseRecord = {
          id: this.ids.next(),
          code: await this.sequence.next('GAS'),
          date: input.date,
          dueDate: input.dueDate ?? null,
          paidAt: input.status === 'PAGADO' ? (input.paidAt ?? input.date) : null,
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
          status: input.status,
          receiptFileId: input.receiptFileId ?? null,
          recurringExpenseId: null,
          periodStart: null,
          createdAt: now,
          updatedAt: now,
          createdById: actor.userId,
        };
        await this.support.persist(this.support.actorOf(actor), 'CREATE', null, record);
        return record.id;
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(id);
  }
}
