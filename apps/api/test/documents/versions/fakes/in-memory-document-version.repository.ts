import type {
  DocumentFileMeta,
  UserRef,
} from '../../../../src/modules/documents/application/ports/document.repository.port';
import type {
  DocumentVersionRepository,
  DocumentVersionRow,
  DocumentVersionWithContent,
} from '../../../../src/modules/documents/application/ports/document-version.repository.port';
import type { DocumentFormat } from '../../../../src/shared/domain/enums';
import type { InMemoryDocumentRepository } from '../../records/fakes/in-memory-document.repository';

export interface InMemoryVersionDeps {
  userRef(id: string): UserRef;
  file(id: string): DocumentFileMeta;
}

/**
 * `DocumentVersionRepository` over the records fake: the versions live in `InMemoryDocumentRepository` (where
 * `appendVersion` writes them) and the draft is written back through its `seed`, which is enough for a fake
 * whose unit of work only has to commit (a rolled-back draft is not what these tests assert).
 */
export class InMemoryDocumentVersionRepository implements DocumentVersionRepository {
  constructor(
    private readonly documents: InMemoryDocumentRepository,
    private readonly deps: InMemoryVersionDeps,
  ) {}

  private rowsOf(documentId: string): DocumentVersionWithContent[] {
    const current = this.documents.rows.find((doc) => doc.id === documentId)?.currentVersionId;
    return this.documents
      .committedVersions(documentId)
      .map((version) => ({
        id: version.id,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        format: version.format,
        content: version.content,
        file: version.fileId ? this.deps.file(version.fileId) : null,
        url: version.url,
        changelog: version.changelog,
        createdBy: this.deps.userRef(version.createdById),
        createdAt: version.createdAt,
        isCurrent: version.id === current,
      }))
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async list(documentId: string): Promise<DocumentVersionRow[]> {
    return this.rowsOf(documentId).map(({ content: _content, ...row }) => row);
  }

  async findInDocument(
    documentId: string,
    versionId: string,
  ): Promise<DocumentVersionWithContent | null> {
    return this.rowsOf(documentId).find((version) => version.id === versionId) ?? null;
  }

  async currentFormat(documentId: string): Promise<DocumentFormat | null> {
    const relations = await this.documents.relationsOf([documentId], '2026-01-01');
    return relations.get(documentId)?.currentVersion?.format ?? null;
  }

  async saveDraft(
    documentId: string,
    change: { readonly content: string; readonly at: Date; readonly byUserId: string },
  ): Promise<void> {
    const doc = await this.documents.findById(documentId);
    if (!doc) throw new Error(`Document ${documentId} not found`);
    this.documents.seed({
      ...doc,
      draftContent: change.content,
      draftUpdatedAt: change.at,
      updatedAt: change.at,
    });
  }

  async clearDraft(documentId: string): Promise<void> {
    const doc = await this.documents.findById(documentId);
    if (!doc) throw new Error(`Document ${documentId} not found`);
    this.documents.seed({ ...doc, draftContent: null, draftUpdatedAt: null });
  }

  async isFileOfLiveDocument(fileId: string): Promise<boolean> {
    return this.documents.rows.some(
      (doc) =>
        doc.deletedAt === null &&
        this.documents.committedVersions(doc.id).some((version) => version.fileId === fileId),
    );
  }
}
