import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { NoteLinkTargetResolver } from '../../commercial/application/note-link-target.registry';
import type { ResolvedNoteTarget } from '../../commercial/application/ports/note-target.port';
import type { RestoreHandler } from '../../platform/application/ports/restore-handler.port';
import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../settings/application/ports/taggable-target.port';
import type { DocumentSupport } from '../application/document-support';
import type { DocumentRepository } from '../application/ports/document.repository.port';
import type { RestoreDocument } from '../application/use-cases/records/restore-document.use-case';

/**
 * Lets settings' tag endpoints tag a document: `update` on `document` governs it, an archived document is
 * not taggable (`null`). The activity entry's client scope comes from the document's links.
 */
export class DocumentTaggableResolver implements TaggableTargetResolver {
  readonly entityType = 'DOCUMENT' as const;
  readonly resource = 'document' as const;

  constructor(
    private readonly documents: DocumentRepository,
    private readonly support: DocumentSupport,
  ) {}

  async resolve(id: string): Promise<TaggableTarget | null> {
    const doc = await this.documents.findById(id);
    if (!doc || doc.deletedAt) return null;
    const links = (await this.documents.links(id)).map((link) => link.target);
    return { label: doc.title, clientId: (await this.support.clientScope(links)).clientId };
  }
}

/**
 * Lets a note hang from a document (TASK-BE BE-2 close note). An archived document still resolves, flagged,
 * so an existing link keeps its label while a new link to it is refused.
 */
export class DocumentNoteTargetResolver implements NoteLinkTargetResolver {
  readonly entityType = 'DOCUMENT' as const;

  constructor(private readonly documents: DocumentRepository) {}

  async resolve(ids: readonly string[]): Promise<Map<string, ResolvedNoteTarget>> {
    const labels = await this.documents.labels(ids);
    return new Map(
      [...labels].map(([id, label]) => [
        id,
        {
          ref: {
            type: 'DOCUMENT' as const,
            id,
            code: label.code,
            label: label.title,
          } satisfies EntityRef,
          archived: label.archived,
        },
      ]),
    );
  }
}

/** Makes archived documents restorable from the trash: the trash delegates to the document's own use case. */
export class DocumentRestoreHandler implements RestoreHandler {
  readonly entityType = 'DOCUMENT' as const;
  readonly resource = 'document' as const;

  constructor(private readonly restoreDocument: RestoreDocument) {}

  restore(user: CurrentUser, entityId: string): Promise<EntityRef> {
    return this.restoreDocument.execute(user, { id: entityId });
  }
}
