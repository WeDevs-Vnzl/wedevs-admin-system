import type {
  FileAccessClaim,
  FileAccessResolver,
} from '../../platform/application/ports/file-access.port';
import type { DocumentVersionRepository } from '../application/ports/document-version.repository.port';

/**
 * Registered in platform's `FileAccessRegistry`: a file held by a version of a live document is downloadable by
 * whoever may `read` documents (C23), the Viewer included. A file of an archived document fails closed (A3,
 * the precedent of notes), and a file of no document is not this context's claim: unattached files stay
 * uploader-only.
 */
export class DocumentFileAccessResolver implements FileAccessResolver {
  constructor(private readonly versions: DocumentVersionRepository) {}

  async resolve(fileId: string): Promise<FileAccessClaim | null> {
    return (await this.versions.isFileOfLiveDocument(fileId))
      ? { kind: 'resource', resource: 'document' }
      : null;
  }
}
