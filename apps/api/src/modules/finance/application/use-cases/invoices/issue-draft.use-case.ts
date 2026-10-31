import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import { INVOICE_ERRORS } from '../../../domain/errors';
import type { InvoiceOutput, InvoiceSupport } from './invoice-support';

/**
 * `issueDraft` (HU-11): turns a draft into an issued invoice, whose totals start to count for billing. Its
 * facts and metrics appear in the same unit of work (a draft produces none).
 */
export class IssueDraft {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: InvoiceSupport,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<InvoiceOutput> {
    assertCan(this.authorization, actor, 'update', 'invoice');
    if (!(await this.support.invoices.findById(input.id))) throw new NotFoundError();
    const plan = await this.support.plan({ invoiceId: input.id });

    await this.uow.run(
      async () => {
        const locked = await this.support.lockPlan(plan);
        const before = await this.support.invoices.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.voidedAt !== null) throw new ConflictError({ message: INVOICE_ERRORS.voided });
        if (!before.isDraft) throw new ConflictError({ message: INVOICE_ERRORS.notDraft });

        const after = await this.support.rederive({
          ...before,
          isDraft: false,
          updatedAt: this.support.nowIso(),
          updatedById: actor.userId,
        });
        await this.support.invoices.update(after);
        await this.support.project(before, after, locked.paymentIds);
        await this.support.record(actorOf(actor), 'UPDATE', before, after, {
          changes: diffFields({ ...before }, { ...after }, { fields: ['isDraft', 'status'] }),
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}
