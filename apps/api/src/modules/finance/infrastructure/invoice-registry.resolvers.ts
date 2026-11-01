import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { NoteLinkTargetResolver } from '../../commercial/application/note-link-target.registry';
import type { ResolvedNoteTarget } from '../../commercial/application/ports/note-target.port';
import type {
  FileAccessClaim,
  FileAccessResolver,
} from '../../platform/application/ports/file-access.port';
import type { RestoreHandler } from '../../platform/application/ports/restore-handler.port';
import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../settings/application/ports/taggable-target.port';
import type { InvoiceRepository } from '../application/ports/invoice.repository.port';
import type { RestoreInvoice } from '../application/use-cases/invoices/restore-invoice.use-case';

/** An invoice file downloads with `read` on invoices (C23); an archived invoice keeps its file readable. */
export class InvoiceFileAccessResolver implements FileAccessResolver {
  constructor(private readonly invoices: InvoiceRepository) {}

  async resolve(fileId: string): Promise<FileAccessClaim | null> {
    return (await this.invoices.hasFile(fileId)) ? { kind: 'resource', resource: 'invoice' } : null;
  }
}

/** Lets settings' tag endpoints tag an invoice: `update` on `invoice` governs it. Archived ones are not taggable. */
export class InvoiceTaggableResolver implements TaggableTargetResolver {
  readonly entityType = 'INVOICE' as const;
  readonly resource = 'invoice' as const;

  constructor(private readonly invoices: InvoiceRepository) {}

  async resolve(id: string): Promise<TaggableTarget | null> {
    const label = (await this.invoices.labels([id])).get(id);
    if (!label || label.archived) return null;
    return { label: label.invoiceNumber, clientId: label.clientId };
  }
}

/** Lets a note hang from an invoice; an archived one keeps its existing links but refuses new ones. */
export class InvoiceNoteTargetResolver implements NoteLinkTargetResolver {
  readonly entityType = 'INVOICE' as const;

  constructor(private readonly invoices: InvoiceRepository) {}

  async resolve(ids: readonly string[]): Promise<Map<string, ResolvedNoteTarget>> {
    const labels = await this.invoices.labels(ids);
    return new Map(
      [...labels].map(([id, label]) => [
        id,
        {
          ref: {
            type: 'INVOICE' as const,
            id,
            code: label.code,
            label: label.invoiceNumber,
          },
          archived: label.archived,
        },
      ]),
    );
  }
}

/** What finance registers so the trash can bring an invoice back: its own `RestoreInvoice` use case. */
export class InvoiceRestoreHandler implements RestoreHandler {
  readonly entityType = 'INVOICE' as const;
  readonly resource = 'invoice' as const;

  constructor(private readonly restoreInvoice: RestoreInvoice) {}

  async restore(user: CurrentUser, entityId: string): Promise<EntityRef> {
    return (await this.restoreInvoice.execute(user, entityId)).entity;
  }
}
