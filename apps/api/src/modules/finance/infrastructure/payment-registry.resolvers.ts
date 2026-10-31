import type {
  FileAccessClaim,
  FileAccessResolver,
} from '../../platform/application/ports/file-access.port';
import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../settings/application/ports/taggable-target.port';
import type { NoteLinkTargetResolver } from '../../commercial/application/note-link-target.registry';
import type { ResolvedNoteTarget } from '../../commercial/application/ports/note-target.port';
import type { PaymentRepository } from '../application/ports/payment.repository.port';

/** A receipt downloads with `read` on payments (C23); a payment is never archived, so any carrier counts. */
export class PaymentReceiptAccessResolver implements FileAccessResolver {
  constructor(private readonly payments: PaymentRepository) {}

  async resolve(fileId: string): Promise<FileAccessClaim | null> {
    return (await this.payments.hasReceiptFile(fileId))
      ? { kind: 'resource', resource: 'payment' }
      : null;
  }
}

/** Lets settings' tag endpoints tag a payment: `update` on `payment` governs it. */
export class PaymentTaggableResolver implements TaggableTargetResolver {
  readonly entityType = 'PAYMENT' as const;
  readonly resource = 'payment' as const;

  constructor(private readonly payments: PaymentRepository) {}

  async resolve(id: string): Promise<TaggableTarget | null> {
    const label = (await this.payments.labels([id])).get(id);
    return label ? { label: label.code, clientId: label.clientId } : null;
  }
}

/** Lets a note hang from a payment; a payment is never archived (Q-BE3-4). */
export class PaymentNoteTargetResolver implements NoteLinkTargetResolver {
  readonly entityType = 'PAYMENT' as const;

  constructor(private readonly payments: PaymentRepository) {}

  async resolve(ids: readonly string[]): Promise<Map<string, ResolvedNoteTarget>> {
    const labels = await this.payments.labels(ids);
    return new Map(
      [...labels].map(([id, label]) => [
        id,
        {
          ref: { type: 'PAYMENT' as const, id, code: label.code, label: label.code },
          archived: false,
        },
      ]),
    );
  }
}
