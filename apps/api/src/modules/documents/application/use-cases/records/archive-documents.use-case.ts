import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { SearchIndexPort } from '../../../../../shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { ArchivedDocumentOutput, DocumentSupport } from '../../document-support';

/**
 * Archives the live documents `ids` in one `Serializable` unit of work, locking them together in id order
 * (DT-126). All or nothing: an unknown or already archived id is `NOT_FOUND` and leaves the rest untouched.
 * Records `DELETE` per document and flips its search entry (C19, C20).
 */
async function archive(
  actor: CurrentUser,
  ids: readonly string[],
  uow: UnitOfWorkPort,
  support: DocumentSupport,
  search: SearchIndexPort,
): Promise<ArchivedDocumentOutput[]> {
  const unique = [...new Set(ids)];
  return uow.run(
    async () => {
      await support.lock(unique);
      const docs = [];
      for (const id of unique) docs.push(await support.requireLive(id));
      const archivedAt = support.now();
      await support.documents.archive(unique, archivedAt, actor.userId);
      for (const doc of docs) {
        await search.setArchived('DOCUMENT', doc.id, true);
        await support.record(actorOf(actor), doc, 'DELETE');
      }
      return docs.map((doc) => ({ id: doc.id, archivedAt }));
    },
    { isolation: 'Serializable' },
  );
}

/** `archiveDocument` (`POST /documents/{id}/archive`, `delete` on `document`: Owner and Admin). */
export class ArchiveDocument {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly search: SearchIndexPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly id: string },
  ): Promise<ArchivedDocumentOutput> {
    assertCan(this.authorization, actor, 'delete', 'document');
    const [archived] = await archive(actor, [input.id], this.uow, this.support, this.search);
    if (!archived) throw new Error('archive returned no document');
    return archived;
  }
}

/** `archiveDocuments` (`POST /documents/archive`, the bulk action): all or nothing. */
export class ArchiveDocuments {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly search: SearchIndexPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly ids: readonly string[] },
  ): Promise<{ archived: ArchivedDocumentOutput[] }> {
    assertCan(this.authorization, actor, 'delete', 'document');
    return { archived: await archive(actor, input.ids, this.uow, this.support, this.search) };
  }
}
