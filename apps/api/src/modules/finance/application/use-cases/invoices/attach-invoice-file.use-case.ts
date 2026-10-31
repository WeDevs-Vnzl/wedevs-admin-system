import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import { INVOICE_ERRORS } from '../../../domain/errors';
import { invalid } from './invoice-input';
import type { InvoiceOutput, InvoiceSupport } from './invoice-support';

export interface AttachInvoiceFileInput {
  readonly id: string;
  /** `null` detaches the current file. */
  readonly fileId: string | null;
}

/**
 * `attachInvoiceFile` (`PUT /invoices/{id}/file`, HU-11 CA4, HU-14 CA1): attaches, replaces or detaches the PDF
 * of the real invoice. The file is claimed inside the unit of work (C23) and must be a `READY` PDF or image
 * of at most 10 MB. An archived invoice is read-only. Nothing money-related changes, so only the invoice row
 * is locked and nothing is projected.
 */
export class AttachInvoiceFile {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: InvoiceSupport,
  ) {}

  async execute(actor: CurrentUser, input: AttachInvoiceFileInput): Promise<InvoiceOutput> {
    assertCan(this.authorization, actor, 'update', 'invoice');
    if (!(await this.support.invoices.findById(input.id))) throw new NotFoundError();

    await this.uow.run(
      async () => {
        await this.support.lockInvoice(input.id);
        const before = await this.support.invoices.findById(input.id);
        if (!before) throw new NotFoundError();
        if (before.archivedAt !== null) throw invalid('id', INVOICE_ERRORS.archived);
        if (input.fileId !== null && input.fileId !== before.fileId) {
          await this.support.reserveFile(actor, input.fileId);
        }
        const after = {
          ...before,
          fileId: input.fileId,
          updatedAt: this.support.nowIso(),
          updatedById: actor.userId,
        };
        await this.support.invoices.update(after);
        await this.support.logOnly(actorOf(actor), 'UPDATE', after, {
          changes: { fileId: [before.fileId, after.fileId] },
        });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(input.id);
  }
}
