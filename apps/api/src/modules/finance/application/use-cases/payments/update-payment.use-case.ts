import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import {
  ConflictError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../../shared/domain/domain-error';
import { compareMoney, toUsd } from '../../../../../shared/domain/money';
import type { PaymentRecord } from '../../ports/payment.repository.port';
import { throwIfAny } from '../expenses/expense-support';
import {
  PAYMENT_MESSAGES,
  normalizePaymentFields,
  paymentFieldErrors,
  type PaymentFields,
} from './payment-input';
import {
  PAYMENT_ACTIVITY_FIELDS,
  derivedColumns,
  type PaymentOutput,
  type PaymentSupport,
} from './payment-support';

export type UpdatePaymentInput = PaymentFields & { readonly id: string };

/**
 * `updatePayment` (Q-BE3-3): the payment fields again; allocations change only through (de)allocate. A voided
 * payment is read-only. One with live allocations keeps its client and currency (`INTEGRITY_LOCK`) and its
 * allocatable amount cannot drop below what is allocated, mirroring `updateInvoice`. The payment gets a new USD
 * snapshot at its new rate; the allocations keep theirs (C16). The invoices are not recomputed: their paid
 * amounts are in the invoice currency and do not move, but they are locked with the payment so no allocation
 * runs against it meanwhile. An absent `receiptFileId` keeps the receipt and `null` detaches it.
 */
export class UpdatePayment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: PaymentSupport,
  ) {}

  async execute(actor: CurrentUser, input: UpdatePaymentInput): Promise<PaymentOutput> {
    assertCan(this.authorization, actor, 'update', 'payment');
    throwIfAny(paymentFieldErrors(input));
    const values = normalizePaymentFields(input);
    if (!(await this.support.payments.findById(input.id))) throw new NotFoundError();

    const planArgs = {
      paymentId: input.id,
      clientIds: [values.clientId],
      accountIds: [values.accountId],
    };

    await this.support.withLocks(this.uow, planArgs, async () => {
      const before = await this.support.payments.findById(input.id);
      if (!before) throw new NotFoundError();
      if (before.status === 'ANULADO') {
        throw new ConflictError({ message: PAYMENT_MESSAGES.voided });
      }
      const live = await this.support.payments.liveAllocations(before.id);

      await this.support.requireClient(values.clientId);
      await this.support.requireAccount(
        values.accountId,
        values.currency,
        values.accountId !== before.accountId,
      );
      await this.support.requireMethod(values.methodId, values.reference);
      if (
        live.length > 0 &&
        (values.clientId !== before.clientId || values.currency !== before.currency)
      ) {
        throw new IntegrityLockedError({ message: PAYMENT_MESSAGES.clientLocked });
      }
      const amounts = derivedColumns(values, live);
      if (compareMoney(amounts.unallocated, '0') < 0) {
        throw new IntegrityLockedError({ message: PAYMENT_MESSAGES.allocatableBelowAllocated });
      }

      let receiptFileId = before.receiptFileId;
      if (values.receiptFileId !== undefined) {
        if (values.receiptFileId !== null && values.receiptFileId !== before.receiptFileId) {
          await this.support.reserveReceipt(actor, values.receiptFileId);
        }
        receiptFileId = values.receiptFileId;
      }

      const after: PaymentRecord = {
        ...before,
        clientId: values.clientId,
        date: values.date,
        accountId: values.accountId,
        methodId: values.methodId,
        currency: values.currency,
        amount: values.amount,
        igtfAmount: values.igtfAmount,
        feeAmount: values.feeAmount,
        ...amounts,
        usdRate: values.usdRate,
        amountUsd: toUsd(values.amount, values.usdRate),
        reference: values.reference,
        receiptFileId,
        updatedAt: this.support.nowIso(),
        updatedById: actor.userId,
      };
      await this.support.payments.update(after);
      await this.support.settle({
        actor: actorOf(actor),
        action: 'UPDATE',
        before,
        after,
        invoiceIds: [],
        changes: diffFields({ ...before }, { ...after }, { fields: PAYMENT_ACTIVITY_FIELDS }),
      });
    });
    return this.support.output(input.id);
  }
}
