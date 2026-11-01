import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { DocumentSupport } from '../../document-support';
import type {
  DocumentVersionRepository,
  DocumentVersionRow,
  DocumentVersionWithContent,
} from '../../ports/document-version.repository.port';

/** The document when it exists and the caller may see it: archived ones only for the trash roles (C14, C19). */
async function readableDocument(
  authorization: AuthorizationPort,
  support: DocumentSupport,
  actor: CurrentUser,
  id: string,
): Promise<void> {
  const doc = await support.documents.findById(id);
  if (!doc) throw new NotFoundError();
  if (doc.deletedAt && !authorization.can(actor, 'restore', 'trash')) throw new NotFoundError();
}

/** `listDocumentVersions` (`GET /documents/{id}/versions`): the history, newest first, without content. */
export class ListDocumentVersions {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly support: DocumentSupport,
    private readonly versions: DocumentVersionRepository,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly documentId: string },
  ): Promise<DocumentVersionRow[]> {
    assertCan(this.authorization, actor, 'read', 'document');
    await readableDocument(this.authorization, this.support, actor, input.documentId);
    return this.versions.list(input.documentId);
  }
}

/**
 * `getDocumentVersion` (`GET /documents/{id}/versions/{versionId}`): one version with its raw markdown, which is
 * what the FE diff reads (HU-18 CA3). A version of another document is `NOT_FOUND`.
 */
export class GetDocumentVersion {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly support: DocumentSupport,
    private readonly versions: DocumentVersionRepository,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly documentId: string; readonly versionId: string },
  ): Promise<DocumentVersionWithContent> {
    assertCan(this.authorization, actor, 'read', 'document');
    await readableDocument(this.authorization, this.support, actor, input.documentId);
    const version = await this.versions.findInDocument(input.documentId, input.versionId);
    if (!version) throw new NotFoundError();
    return version;
  }
}
