import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import {
  ConflictError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../../shared/domain/domain-error';
import { INVOICE_ERRORS } from '../../../domain/errors';
import type { InvoiceRecord } from '../../ports/invoice.repository.port';
import { INVOICE_MESSAGES, invalid } from './invoice-input';
import type { InvoiceOutput, InvoiceSupport } from './invoice-support';

export interface VoidInvoiceInput {
  readonly id: string;
  readonly reason: string;
}

/**
 * `voidInvoice` (HU-12 CA5): annuls an invoice with a mandatory reason. Refused while a payment allocates to it
 * (`INTEGRITY_LOCK`): those allocations are removed first, so the payments keep their credit balance. Its
 * installments are released, and its facts and metrics leave in the same unit of work.
 */
export class VoidInvoice {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: InvoiceSupport,
  ) {}

  async execute(actor: CurrentUser, input: VoidInvoiceInput): Promise<InvoiceOutput> {
    assertCan(this.authorization, actor, 'update', 'invoice');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason === '') throw invalid('reason', INVOICE_MESSAGES.required);
    if (reason.length > 500) throw invalid('reason', INVOICE_MESSAGES.tooLong);
    if (!(await this.support.invoices.findById(input.id))) throw new NotFoundError();
    const plan = await this.support.plan({ invoiceId: input.id });

    await this.uow.run(
      async () => {
        await this.support.lockPlan(plan);
        const before = await this.support.invoices.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.voidedAt !== null) {
          throw new ConflictError({ message: INVOICE_ERRORS.alreadyVoided });
        }
        if ((await this.support.invoices.liveAllocations(before.id)).length > 0) {
          throw new IntegrityLockedError({ message: INVOICE_ERRORS.hasAllocations });
        }
        const now = this.support.nowIso();
        const after: InvoiceRecord = await this.support.rederive({
          ...before,
          voidedAt: now,
          voidReason: reason,
          updatedAt: now,
          updatedById: actor.userId,
        });
        await this.support.invoices.update(after);
        await this.support.project(before, after);
        await this.support.record(actorOf(actor), 'STATUS_CHANGE', before, after, {
          metadata: { from: before.status, to: after.status, reason },
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}
