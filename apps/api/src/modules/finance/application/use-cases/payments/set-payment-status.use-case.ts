import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { PAYMENT_STATUS_VALUES, type PaymentStatus } from '../../../../../shared/domain/enums';
import type { PaymentRecord } from '../../ports/payment.repository.port';
import { addError, textError, throwIfAny } from '../expenses/expense-support';
import { PAYMENT_MESSAGES } from './payment-input';
import { derivedColumns, type PaymentOutput, type PaymentSupport } from './payment-support';

export interface SetPaymentStatusInput {
  readonly id: string;
  readonly status: PaymentStatus;
  readonly reason?: string | null | undefined;
}

/** The transitions of Q-BE3-3; `ANULADO` is final. */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDIENTE_VERIFICACION: ['CONFIRMADO', 'ANULADO'],
  CONFIRMADO: ['ANULADO'],
  ANULADO: [],
};

/**
 * `setPaymentStatus` (Q-BE3-3, PRD:760, PRD:1257): `PENDIENTE_VERIFICACION → CONFIRMADO | ANULADO` and
 * `CONFIRMADO → ANULADO`. Confirming rechecks the allocation limits against the invoice balances as they are
 * now (a pending payment's allocations did not reduce them). Voiding soft-deletes the live allocations in the
 * same unit of work, so the invoices go back to their balance. The invoices, their installments, the payment
 * facts, the account balance and the client and project metrics are recomputed in that unit of work; the
 * reason goes to the activity metadata (no column).
 */
export class SetPaymentStatus {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: PaymentSupport,
  ) {}

  async execute(actor: CurrentUser, input: SetPaymentStatusInput): Promise<PaymentOutput> {
    assertCan(this.authorization, actor, 'update', 'payment');
    const errors = {};
    if (!(PAYMENT_STATUS_VALUES as readonly string[]).includes(input.status)) {
      addError(errors, 'status', PAYMENT_MESSAGES.invalidOption);
    }
    textError(errors, 'reason', input.reason, 500, false);
    throwIfAny(errors);
    const reason = input.reason?.trim();
    if (!(await this.support.payments.findById(input.id))) throw new NotFoundError();

    const plan = await this.support.plan({ paymentId: input.id });
    await this.uow.run(
      async () => {
        const locked = await this.support.lockPlan(plan);
        const before = await this.support.payments.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.status === 'ANULADO') {
          throw new ConflictError({ message: PAYMENT_MESSAGES.voided });
        }
        if (!TRANSITIONS[before.status].includes(input.status)) {
          throw new ConflictError({ message: PAYMENT_MESSAGES.invalidTransition });
        }
        const live = await this.support.payments.liveAllocations(before.id);

        let remaining = live;
        if (input.status === 'CONFIRMADO' && live.length > 0) {
          await this.support.checkAllocations(
            {
              clientId: before.clientId,
              currency: before.currency,
              allocatable: before.allocatable,
            },
            live,
            [],
          );
        }
        if (input.status === 'ANULADO') {
          const now = this.support.nowIso();
          await this.support.payments.softDeleteAllocations(
            live.map((allocation) => allocation.id),
            now,
          );
          remaining = [];
        }
        const after: PaymentRecord = {
          ...before,
          ...derivedColumns(before, remaining),
          status: input.status,
          updatedAt: this.support.nowIso(),
          updatedById: actor.userId,
        };
        await this.support.payments.update(after);
        await this.support.settle({
          actor: actorOf(actor),
          action: 'STATUS_CHANGE',
          before,
          after,
          invoiceIds: locked.invoiceIds,
          metadata: { from: before.status, to: after.status, ...(reason ? { reason } : {}) },
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}
