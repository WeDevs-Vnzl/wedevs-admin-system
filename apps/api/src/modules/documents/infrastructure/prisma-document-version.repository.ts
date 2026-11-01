import { Injectable } from '@nestjs/common';
import type { DocumentFormat } from '../../../shared/domain/enums';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { UserRef } from '../application/ports/document.repository.port';
import { FILE_META, userRefsById } from './prisma-read-helpers';
import type {
  DocumentVersionRepository,
  DocumentVersionRow,
  DocumentVersionWithContent,
} from '../application/ports/document-version.repository.port';

type VersionRow = Prisma.DocumentVersionGetPayload<{
  include: { file: { select: typeof FILE_META } };
}>;

/** Reads of versions and the markdown draft of a document (DT-139, DT-140). */
@Injectable()
export class PrismaDocumentVersionRepository implements DocumentVersionRepository {
  constructor(private readonly host: TransactionHost) {}

  async list(documentId: string): Promise<DocumentVersionRow[]> {
    const db = this.host.db;
    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { currentVersionId: true },
    });
    const rows = await db.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      include: { file: { select: FILE_META } },
    });
    const users = await this.users(rows.map((row) => row.createdById));
    return rows.map((row) => this.toRow(row, document?.currentVersionId ?? null, users));
  }

  async findInDocument(
    documentId: string,
    versionId: string,
  ): Promise<DocumentVersionWithContent | null> {
    const db = this.host.db;
    const row = await db.documentVersion.findFirst({
      where: { id: versionId, documentId },
      include: { file: { select: FILE_META } },
    });
    if (!row) return null;
    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { currentVersionId: true },
    });
    const users = await this.users([row.createdById]);
    return { ...this.toRow(row, document?.currentVersionId ?? null, users), content: row.content };
  }

  async currentFormat(documentId: string): Promise<DocumentFormat | null> {
    const row = await this.host.db.document.findUnique({
      where: { id: documentId },
      select: { currentVersion: { select: { format: true } } },
    });
    return row?.currentVersion?.format ?? null;
  }

  async saveDraft(
    documentId: string,
    change: { readonly content: string; readonly at: Date; readonly byUserId: string },
  ): Promise<void> {
    await this.host.db.document.update({
      where: { id: documentId },
      data: {
        draftContent: change.content,
        draftUpdatedAt: change.at,
        updatedAt: change.at,
        updatedById: change.byUserId,
      },
    });
  }

  async clearDraft(documentId: string): Promise<void> {
    await this.host.db.document.update({
      where: { id: documentId },
      data: { draftContent: null, draftUpdatedAt: null },
    });
  }

  async isFileOfLiveDocument(fileId: string): Promise<boolean> {
    const count = await this.host.db.documentVersion.count({
      where: { fileId, document: { deletedAt: null } },
    });
    return count > 0;
  }

  private async users(ids: readonly string[]): Promise<Map<string, UserRef>> {
    return userRefsById(this.host.db, ids);
  }

  private toRow(
    row: VersionRow,
    currentVersionId: string | null,
    users: ReadonlyMap<string, UserRef>,
  ): DocumentVersionRow {
    return {
      id: row.id,
      documentId: row.documentId,
      versionNumber: row.versionNumber,
      format: row.format,
      file: row.file,
      url: row.url,
      changelog: row.changelog,
      createdBy: users.get(row.createdById) ?? { id: row.createdById, name: '', imageUrl: null },
      createdAt: row.createdAt,
      isCurrent: row.id === currentVersionId,
    };
  }
}
