import { ForbiddenError } from '../../../../../shared/domain/domain-error';
import type { PortalSupport, PortalVisitor } from './portal-support';

export interface RecordShareViewInput {
  readonly token: string;
  /** The document the visitor opened; absent for a view of the page. */
  readonly documentId?: string | undefined;
  readonly visitor: PortalVisitor;
}

/**
 * `recordShareView` (the `VIEW` of `recordShareAccess`, contract choice 2): appends one `VIEW` row and
 * increments the stored counter. A `VIEW` of a locked document without its unlock cookie is `FORBIDDEN` and
 * writes nothing; the link-level `VIEW` needs no cookie. `DOWNLOAD` is not client-recordable: the file route logs it.
 */
export class RecordShareView {
  constructor(private readonly support: PortalSupport) {}

  async execute(input: RecordShareViewInput): Promise<{ readonly recorded: true }> {
    const link = await this.support.liveLink(input.token);
    if (input.documentId !== undefined) {
      const row = await this.support.sharedDocument(link, input.documentId);
      // A locked document is not viewed until it is unlocked: nothing is logged or counted for it.
      if (this.support.isLocked(row, this.support.unlockedIds(input.visitor, link.token))) {
        throw new ForbiddenError();
      }
    }
    await this.support.logAccess(link, 'VIEW', input.documentId ?? null, input.visitor);
    return { recorded: true };
  }
}
