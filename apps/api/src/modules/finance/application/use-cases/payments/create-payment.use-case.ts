import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { SequencePort } from '../../../../../shared/application/ports/sequence.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { toUsd } from '../../../../../shared/domain/money';
import type { PaymentRecord } from '../../ports/payment.repository.port';
import { addError, throwIfAny } from '../expenses/expense-support';
import {
  PAYMENT_MESSAGES,
  allocationListErrors,
  normalizePaymentFields,
  paymentFieldErrors,
  type AllocationInput,
  type PaymentFields,
} from './payment-input';
import { derivedColumns, type PaymentOutput, type PaymentSupport } from './payment-support';

export interface CreatePaymentInput extends PaymentFields {
  /** A payment is created pending verification or confirmed; voiding goes through `setPaymentStatus`. */
  readonly status?: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO' | undefined;
  readonly allocations?: readonly AllocationInput[] | undefined;
}

/**
 * `createPayment` (PRD §8.6, HU-13): a payment received from a client. The method decides whether a reference is
 * required (CA1), the IGTF and fee cannot exceed the amount (CA2), and the allocations go to the client's open
 * invoices within the allocatable amount and each invoice balance (CA3, CA4); the unallocated rest is the
 * client's credit (CA5). A duplicate reference is never refused here (CA6 is `detectDuplicatePayment`). The USD
 * snapshots are taken once at the payment rate (§9.2, C16).
 *
 * `can(create, payment)` → shape → `Serializable` unit of work: one lock call (projects, client, installments,
 * invoices, account) → references → receipt → allocation limits against the committed invoice balances →
 * sequence → insert → invoices, facts, balance and metrics → search → activity.
 */
export class CreatePayment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: PaymentSupport,
    private readonly sequence: SequencePort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreatePaymentInput): Promise<PaymentOutput> {
    assertCan(this.authorization, actor, 'create', 'payment');
    const status = input.status ?? 'CONFIRMADO';
    const allocations = input.allocations ?? [];
    const errors = paymentFieldErrors(input);
    if (status !== 'PENDIENTE_VERIFICACION' && status !== 'CONFIRMADO') {
      addError(errors, 'status', PAYMENT_MESSAGES.invalidOption);
    }
    Object.assign(errors, allocationListErrors(allocations));
    throwIfAny(errors);
    const values = normalizePaymentFields(input);

    const plan = await this.support.plan({
      clientIds: [values.clientId],
      accountIds: [values.accountId],
      invoiceIds: allocations.map((allocation) => allocation.invoiceId),
    });

    const id = await this.uow.run(
      async () => {
        await this.support.lockPlan(plan);
        await this.support.requireClient(values.clientId);
        await this.support.requireAccount(values.accountId, values.currency, true);
        await this.support.requireMethod(values.methodId, values.reference);
        if (values.receiptFileId) await this.support.reserveReceipt(actor, values.receiptFileId);

        const amounts = derivedColumns(values, []);
        await this.support.checkAllocations(
          {
            clientId: values.clientId,
            currency: values.currency,
            allocatable: amounts.allocatable,
          },
          allocations,
          [],
        );

        const now = this.support.nowIso();
        const record: PaymentRecord = {
          id: this.ids.next(),
          code: await this.sequence.next('PAG'),
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
          status,
          receiptFileId: values.receiptFileId ?? null,
          createdAt: now,
          updatedAt: now,
          createdById: actor.userId,
          updatedById: null,
        };
        await this.support.payments.insert(record);
        const rows = allocations.map((draft) =>
          this.support.allocationRecord(record, draft, this.ids.next(), actor.userId),
        );
        for (const row of rows) await this.support.payments.insertAllocation(row);
        const stored = {
          ...record,
          ...derivedColumns(values, rows),
        };
        if (rows.length > 0) await this.support.payments.update(stored);

        await this.support.settle({
          actor: actorOf(actor),
          action: 'CREATE',
          before: null,
          after: stored,
          invoiceIds: rows.map((row) => row.invoiceId),
        });
        return record.id;
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(id);
  }
}
