import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { DocumentVersionRepository } from '../../ports/document-version.repository.port';
import {
  isHttpUrl,
  previewOf,
  type PortalDocumentContent,
  type PortalDocumentView,
  type PortalSupport,
  type PortalVisitor,
} from './portal-support';

export interface GetSharedDocumentInput {
  readonly token: string;
  readonly documentId: string;
  readonly visitor: PortalVisitor;
}

/**
 * `getSharedDocument` (HU-22 CA6, CA7): what the viewer renders for one document of the link. A document outside
 * the link or archived is `NOT_FOUND`; a locked one is `FORBIDDEN`. The markdown is returned raw (C4).
 */
export class GetSharedDocument {
  constructor(
    private readonly support: PortalSupport,
    private readonly versions: DocumentVersionRepository,
  ) {}

  async execute(input: GetSharedDocumentInput): Promise<PortalDocumentView> {
    const link = await this.support.liveLink(input.token);
    const row = await this.support.sharedDocument(link, input.documentId);
    const unlocked = this.support.unlockedIds(input.visitor, link.token);
    if (this.support.isLocked(row, unlocked)) throw new ForbiddenError();

    const version = await this.versions.findInDocument(row.documentId, row.version.id);
    if (!version) throw new NotFoundError();
    let content: PortalDocumentContent;
    if (version.format === 'MARKDOWN') {
      content = { format: 'MARKDOWN', markdown: version.content ?? '' };
    } else if (version.format === 'ENLACE') {
      if (!version.url || !isHttpUrl(version.url)) throw new NotFoundError();
      content = { format: 'ENLACE', url: version.url };
    } else {
      if (!version.file || version.file.status !== 'READY') throw new NotFoundError();
      content = {
        format: 'ARCHIVO',
        fileName: version.file.originalName,
        mimeType: version.file.mimeType,
        sizeBytes: version.file.sizeBytes,
        preview: previewOf(version.file.mimeType),
      };
    }
    const document = await this.support.toPortalDocument(row, unlocked);
    return { document: { ...document, locked: false }, content };
  }
}
