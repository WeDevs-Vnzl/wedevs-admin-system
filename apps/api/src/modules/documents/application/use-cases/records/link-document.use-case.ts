import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import {
  sameTarget,
  type DocumentLinkView,
  type DocumentSupport,
  type DocumentViews,
} from '../../document-support';
import type { DocumentLinkTarget } from '../../ports/document.repository.port';

export interface DocumentLinkInput {
  readonly documentId: string;
  readonly target: DocumentLinkTarget;
}

/**
 * `linkDocument` (`POST /documents/{id}/links`, HU-20 CA1): hangs the document from one more record and returns
 * its links. Idempotent: a repeated target changes nothing and writes no entry. A type the caller cannot read
 * (DT-142), an unknown or an archived record is `NOT_FOUND`; an unregistered type is `VALIDATION`.
 * `Serializable` under the `Document` row lock, so two concurrent links of one target leave one row.
 */
export class LinkDocument {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: DocumentLinkInput): Promise<DocumentLinkView[]> {
    assertCan(this.authorization, actor, 'update', 'document');

    await this.uow.run(
      async () => {
        await this.support.lock([input.documentId]);
        const doc = await this.support.requireLive(input.documentId);
        await this.support.requireLinkTargets(actor, [input.target], () => 'entityType');
        const added = await this.support.documents.addLink(doc.id, input.target, {
          id: this.support.nextId(),
          createdAt: this.support.now(),
          createdById: actor.userId,
        });
        if (!added) return;
        await this.support.record(actorOf(actor), doc, 'LINK', {
          metadata: { entityType: input.target.entityType, entityId: input.target.entityId },
        });
      },
      { isolation: 'Serializable' },
    );
    return this.views.links(actor, input.documentId);
  }
}

/**
 * `unlinkDocument` (`DELETE /documents/{id}/links/{entityType}/{entityId}`, HU-20 CA2): removes one link row
 * (`DocumentLink` has no `deletedAt`, so the delete is physical) and returns the remaining links. The other
 * links and the document are untouched; a target the document is not linked to changes nothing. A target
 * type the caller cannot read is `NOT_FOUND`, as for linking (DT-142).
 */
export class UnlinkDocument {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: DocumentLinkInput): Promise<DocumentLinkView[]> {
    assertCan(this.authorization, actor, 'update', 'document');
    if (!this.support.canReadTarget(actor, input.target.entityType)) throw new NotFoundError();

    await this.uow.run(
      async () => {
        await this.support.lock([input.documentId]);
        const doc = await this.support.requireLive(input.documentId);
        const links = (await this.support.documents.links(doc.id)).map((link) => link.target);
        if (!links.some((link) => sameTarget(link, input.target))) return;
        await this.support.documents.removeLink(doc.id, input.target);
        await this.support.record(
          actorOf(actor),
          doc,
          'UNLINK',
          { metadata: { entityType: input.target.entityType, entityId: input.target.entityId } },
          links,
        );
      },
      { isolation: 'Serializable' },
    );
    return this.views.links(actor, input.documentId);
  }
}
