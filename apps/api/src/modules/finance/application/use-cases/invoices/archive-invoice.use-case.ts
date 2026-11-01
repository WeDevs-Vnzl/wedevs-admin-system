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
import type { InvoiceOutput, InvoiceSupport } from './invoice-support';

/**
 * `archiveInvoice` (PRD §7.7, C19): the invoice leaves the lists and frees its number. One with live
 * allocations is voided, not archived (`INTEGRITY_LOCK`). Its installments are released and its facts and
 * metrics leave in the same unit of work. Invoices are the only finance record that is archived (Q-BE3-4).
 */
export class ArchiveInvoice {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: InvoiceSupport,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<InvoiceOutput> {
    assertCan(this.authorization, actor, 'delete', 'invoice');
    if (!(await this.support.invoices.findById(input.id))) throw new NotFoundError();
    const plan = await this.support.plan({ invoiceId: input.id });

    await this.uow.run(
      async () => {
        await this.support.lockPlan(plan);
        const before = await this.support.invoices.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.archivedAt !== null) {
          throw new ConflictError({ message: INVOICE_ERRORS.alreadyArchived });
        }
        if ((await this.support.invoices.liveAllocations(before.id)).length > 0) {
          throw new IntegrityLockedError({ message: INVOICE_ERRORS.hasAllocations });
        }
        const now = this.support.nowIso();
        const after: InvoiceRecord = {
          ...before,
          archivedAt: now,
          archivedById: actor.userId,
          updatedAt: now,
          updatedById: actor.userId,
        };
        await this.support.invoices.update(after);
        await this.support.project(before, after);
        await this.support.record(actorOf(actor), 'DELETE', before, after);
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}
