import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError, ValidationFailedError } from '../../../../../shared/domain/domain-error';
import { assertMarkdownDocument, assertVersionAllowed } from '../../../domain';
import type { DocumentDetail, DocumentSupport, DocumentViews } from '../../document-support';
import type { DocumentVersionRepository } from '../../ports/document-version.repository.port';
import { assertContentSize, normalizeChangelog } from './version-input';

export interface PublishVersionInput {
  readonly documentId: string;
  /** The editor's latest text, saved or not; otherwise the stored draft is published. */
  readonly content?: string | null;
  readonly changelog?: string | null;
}

/**
 * `publishVersion` (`POST /documents/{id}/versions/publish`, PRD §8.9.3): freezes `content` (or else the stored
 * draft) as the immutable `MARKDOWN` version N+1, makes it current and clears the draft. No content and no draft
 * is `VALIDATION` on `content`; a locked document is `INTEGRITY_LOCK` (DT-138), a file or link one `CONFLICT`.
 * `Serializable` under the `Document` row lock, so two publishes get consecutive numbers and a concurrent
 * `FIRMADO` is either seen or waited for.
 */
export class PublishVersion {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly versions: DocumentVersionRepository,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: PublishVersionInput): Promise<DocumentDetail> {
    assertCan(this.authorization, actor, 'update', 'document');
    const changelog = normalizeChangelog(input.changelog);
    if (input.content) assertContentSize(input.content);

    await this.uow.run(
      async () => {
        await this.support.lock([input.documentId]);
        const doc = await this.support.requireLive(input.documentId);
        assertVersionAllowed(doc);
        const type = await this.support.requireType(doc.typeId);
        assertMarkdownDocument(await this.versions.currentFormat(doc.id), type.defaultFormat);

        const content = input.content || doc.draftContent;
        if (!content) {
          throw new ValidationFailedError({ fieldErrors: { content: ['validation.required'] } });
        }
        await this.support.appendVersion(
          actor,
          doc,
          { format: 'MARKDOWN', content, fileId: null, url: null },
          changelog,
        );
        await this.versions.clearDraft(doc.id);
      },
      { isolation: 'Serializable' },
    );

    const doc = await this.support.documents.findById(input.documentId);
    if (!doc) throw new NotFoundError();
    return this.views.detail(actor, doc);
  }
}
