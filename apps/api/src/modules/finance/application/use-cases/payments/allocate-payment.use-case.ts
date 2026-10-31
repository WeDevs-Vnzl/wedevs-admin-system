import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import { PAYMENT_ERRORS } from '../../../domain/errors';
import type { PaymentAllocationView, PaymentRecord } from '../../ports/payment.repository.port';
import { throwIfAny } from '../expenses/expense-support';
import { PAYMENT_MESSAGES, allocationFieldErrors, type AllocationInput } from './payment-input';
import { derivedColumns, type PaymentOutput, type PaymentSupport } from './payment-support';

export type AllocatePaymentInput = AllocationInput & { readonly paymentId: string };
export interface DeallocatePaymentInput {
  readonly allocationId: string;
}

/**
 * `allocatePayment` (HU-13 CA3): applies one more amount of a confirmed payment to an open invoice. The limits
 * (invoice of the client and open, same-currency amounts equal, total within the allocatable amount, amount
 * within the invoice balance) are checked inside the unit of work after the locks, against the committed
 * balances (C18). A second live allocation to the same invoice is a `CONFLICT` (`allocation_unique_active`). The
 * USD snapshot is taken once at the payment rate (§9.5, C16).
 */
export class AllocatePayment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: PaymentSupport,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: AllocatePaymentInput): Promise<PaymentAllocationView> {
    assertCan(this.authorization, actor, 'update', 'payment');
    const errors: FieldErrors = {};
    allocationFieldErrors(errors, 'allocations.0.', input);
    throwIfAny(errors);
    if (!(await this.support.payments.findById(input.paymentId))) throw new NotFoundError();

    const plan = await this.support.plan({
      paymentId: input.paymentId,
      invoiceIds: [input.invoiceId],
    });
    const allocationId = await this.uow.run(
      async () => {
        await this.support.lockPlan(plan);
        const before = await this.support.payments.findById(input.paymentId);
        if (!before) throw new NotFoundError();
        if (before.status !== 'CONFIRMADO') {
          throw new ValidationFailedError({
            fieldErrors: { paymentId: [PAYMENT_ERRORS.paymentNotConfirmed] },
          });
        }
        const existing = await this.support.payments.liveAllocations(before.id);
        if (existing.some((row) => row.invoiceId === input.invoiceId)) {
          throw new ConflictError({
            fieldErrors: {
              'allocations.0.invoiceId': [PAYMENT_MESSAGES.duplicateInvoiceAllocation],
            },
          });
        }
        await this.support.checkAllocations(before, [input], existing);

        const row = this.support.allocationRecord(before, input, this.ids.next(), actor.userId);
        await this.support.payments.insertAllocation(row);
        const after: PaymentRecord = {
          ...before,
          ...derivedColumns(before, [...existing, row]),
          updatedAt: this.support.nowIso(),
          updatedById: actor.userId,
        };
        await this.support.payments.update(after);
        await this.support.settle({
          actor: actorOf(actor),
          action: 'ALLOCATE',
          before,
          after,
          invoiceIds: [input.invoiceId],
          metadata: {
            allocationId: row.id,
            invoiceId: row.invoiceId,
            amountPaymentCurrency: row.amountPaymentCurrency,
            amountInvoiceCurrency: row.amountInvoiceCurrency,
            amountUsd: row.amountUsd,
          },
        });
        return row.id;
      },
      { isolation: 'Serializable' },
    );
    const payment = await this.support.output(input.paymentId);
    const created = payment.allocations.find((row) => row.id === allocationId);
    if (!created) throw new NotFoundError();
    return created;
  }
}

/**
 * `deallocatePayment`: removes an application (soft delete, contract choice 3): the payment goes back to its
 * credit and the invoice balance, status and installments are recomputed. A removed or unknown allocation is
 * `NOT_FOUND`.
 */
export class DeallocatePayment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: PaymentSupport,
  ) {}

  async execute(actor: CurrentUser, input: DeallocatePaymentInput): Promise<PaymentOutput> {
    assertCan(this.authorization, actor, 'update', 'payment');
    const first = await this.support.payments.findAllocation(input.allocationId);
    if (!first || first.deletedAt !== null) throw new NotFoundError();

    const plan = await this.support.plan({ paymentId: first.paymentId });
    await this.uow.run(
      async () => {
        await this.support.lockPlan(plan);
        const allocation = await this.support.payments.findAllocation(input.allocationId);
        if (!allocation || allocation.deletedAt !== null) throw new NotFoundError();
        const before = await this.support.payments.findById(allocation.paymentId);
        if (!before) throw new NotFoundError();

        await this.support.payments.softDeleteAllocations([allocation.id], this.support.nowIso());
        const remaining = (await this.support.payments.liveAllocations(before.id)).filter(
          (row) => row.id !== allocation.id,
        );
        const after: PaymentRecord = {
          ...before,
          ...derivedColumns(before, remaining),
          updatedAt: this.support.nowIso(),
          updatedById: actor.userId,
        };
        await this.support.payments.update(after);
        await this.support.settle({
          actor: actorOf(actor),
          action: 'DEALLOCATE',
          before,
          after,
          invoiceIds: [allocation.invoiceId],
          metadata: {
            allocationId: allocation.id,
            invoiceId: allocation.invoiceId,
            amountPaymentCurrency: allocation.amountPaymentCurrency,
            amountInvoiceCurrency: allocation.amountInvoiceCurrency,
          },
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(first.paymentId);
  }
}
