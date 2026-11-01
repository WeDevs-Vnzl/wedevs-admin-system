import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import { assertVersionAllowed } from '../../../domain';
import type { DocumentDetail, DocumentSupport, DocumentViews } from '../../document-support';
import type { DocumentVersionRepository } from '../../ports/document-version.repository.port';
import { normalizeChangelog } from './version-input';

export interface RestoreVersionInput {
  readonly documentId: string;
  readonly versionId: string;
  readonly changelog?: string | null;
}

/**
 * `restoreVersion` (`POST /documents/{id}/versions/{versionId}/restore`, PRD §8.9.3 "Historial"): a new current
 * version N+1 copying the chosen one (format, file, URL, content); the history is never rewritten. A version of
 * another document is `NOT_FOUND`; a locked document is `INTEGRITY_LOCK`. A restored file keeps its `fileId`
 * (DT-136) and is not reserved again: it is already held by a version of this very document, so no new
 * `File` lock or "held by a version" check applies. Logs `VERSION_PUBLISH` with `restoredFrom`.
 */
export class RestoreVersion {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly versions: DocumentVersionRepository,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: RestoreVersionInput): Promise<DocumentDetail> {
    assertCan(this.authorization, actor, 'update', 'document');
    const changelog = normalizeChangelog(input.changelog);

    await this.uow.run(
      async () => {
        await this.support.lock([input.documentId]);
        const doc = await this.support.requireLive(input.documentId);
        const chosen = await this.versions.findInDocument(doc.id, input.versionId);
        if (!chosen) throw new NotFoundError();
        assertVersionAllowed(doc);

        await this.support.appendVersion(
          actor,
          doc,
          {
            format: chosen.format,
            content: chosen.content,
            fileId: chosen.file?.id ?? null,
            url: chosen.url,
          },
          changelog,
          chosen.versionNumber,
        );
      },
      { isolation: 'Serializable' },
    );

    const doc = await this.support.documents.findById(input.documentId);
    if (!doc) throw new NotFoundError();
    return this.views.detail(actor, doc);
  }
}
