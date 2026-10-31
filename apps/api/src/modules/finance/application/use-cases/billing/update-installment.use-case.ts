import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import {
  ConflictError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../../shared/domain/domain-error';
import { compareMoney, roundMoney, type MoneyString } from '../../../../../shared/domain/money';
import type { BillingRepository, InstallmentPatch } from '../../ports/billing.repository.port';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import {
  assertKnownCurrencies,
  BILLING_ERRORS,
  BILLING_MESSAGES,
  currencyShapeError,
  dateError,
  FieldCollector,
  installmentAmountError,
  labelError,
  loadPage,
  orderError,
  percentageError,
  triggerError,
  type BillingPageView,
} from './billing-support';
import type { BillingTransaction } from './billing-transaction';

export interface UpdateInstallmentInput {
  readonly id: string;
  readonly label?: string | undefined;
  readonly amount?: MoneyString | undefined;
  readonly currency?: string | undefined;
  readonly percentage?: MoneyString | null | undefined;
  readonly dueDate?: DateOnly | null | undefined;
  readonly trigger?: string | null | undefined;
  readonly order?: number | undefined;
}

function percentageChanged(stored: MoneyString | null, next: MoneyString | null): boolean {
  if (stored === null || next === null) return stored !== next;
  return compareMoney(stored, next) !== 0;
}

/**
 * `PATCH /installments/{id}` (HU-09 CA3, C19). A billed installment (a live invoice line references it) keeps
 * its amount, currency and schedule: only the label may change (`INTEGRITY_LOCK` otherwise). A cancelled one is
 * read-only (`CONFLICT`). The installment row is locked before it is read, so an invoice created at the
 * same time either goes first (the edit is refused) or waits.
 */
export class UpdateInstallment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly currencies: CurrencyCatalogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: UpdateInstallmentInput): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'update', 'billing');
    const stored = await this.repository.findInstallment(input.id);
    if (stored === null) throw new NotFoundError();
    // The kind never changes, so the amount rule can be checked before the lock.
    this.validate(input, stored.kind);

    return this.tx.run(
      actorOf(actor),
      stored.projectId,
      { BillingInstallment: [stored.id] },
      async (project) => {
        const row = await this.repository.findInstallment(input.id);
        if (row === null || row.projectId !== project.id) throw new NotFoundError();
        if (row.cancelledAt !== null) {
          throw new ConflictError({ message: BILLING_ERRORS.installmentCancelled });
        }
        const amount = input.amount === undefined ? undefined : roundMoney(input.amount);
        // A billed installment only accepts a new label (C19): any other field that changes is refused.
        const nonLabelChanged =
          (amount !== undefined && compareMoney(amount, row.amount) !== 0) ||
          (input.currency !== undefined && input.currency !== row.currency) ||
          (input.percentage !== undefined && percentageChanged(row.percentage, input.percentage)) ||
          (input.dueDate !== undefined && input.dueDate !== row.dueDate) ||
          (input.trigger !== undefined && input.trigger !== row.trigger) ||
          (input.order !== undefined && input.order !== row.order);
        if (row.locked && nonLabelChanged) {
          throw new IntegrityLockedError({ message: BILLING_ERRORS.installmentBilled });
        }
        if (input.currency !== undefined) {
          await assertKnownCurrencies(this.currencies, [
            { path: 'currency', code: input.currency },
          ]);
        }
        const patch: InstallmentPatch = {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(amount !== undefined ? { amount } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.percentage !== undefined ? { percentage: input.percentage } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
          ...(input.order !== undefined ? { order: input.order } : {}),
        };
        await this.repository.updateInstallment(row.id, patch, this.clock.now());
        return {
          value: await loadPage(this.repository, project.id),
          changed: true,
          activity: [
            {
              action: 'UPDATE',
              entityType: 'INSTALLMENT',
              entityId: row.id,
              entityLabel: input.label ?? row.label,
              metadata: { projectId: project.id },
            },
          ],
        };
      },
    );
  }

  private validate(
    input: UpdateInstallmentInput,
    kind: Parameters<typeof installmentAmountError>[0],
  ): void {
    const errors = new FieldCollector();
    const fields = [
      input.label,
      input.amount,
      input.currency,
      input.percentage,
      input.dueDate,
      input.trigger,
      input.order,
    ];
    if (fields.every((value) => value === undefined)) {
      errors.add('_form', BILLING_MESSAGES.nothingToUpdate);
    }
    const check = (field: string, key: string | null) => key !== null && errors.add(field, key);
    if (input.label !== undefined) check('label', labelError(input.label));
    if (input.amount !== undefined) check('amount', installmentAmountError(kind, input.amount));
    if (input.currency !== undefined) check('currency', currencyShapeError(input.currency));
    if (input.percentage != null) check('percentage', percentageError(input.percentage));
    if (input.dueDate != null) check('dueDate', dateError(input.dueDate));
    if (input.trigger != null) check('trigger', triggerError(input.trigger));
    if (input.order !== undefined) check('order', orderError(input.order));
    errors.throwIfAny();
  }
}
