import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  PortalDocumentRow,
  PortalReadPort,
  PortalServedVersion,
} from '../application/ports/portal-read.port';

const SERVED = {
  id: true,
  documentId: true,
  versionNumber: true,
  format: true,
  createdAt: true,
} as const;

/**
 * The portal's read side (C22, DT-140): `ShareLinkDocument`, `Document` and `DocumentVersion`, all owned by this
 * context. It selects no author, no key hash and no `File` column; the content of a version and its file
 * metadata come from `DocumentVersionRepository` for the one document being opened.
 */
@Injectable()
export class PrismaPortalRead implements PortalReadPort {
  constructor(private readonly host: TransactionHost) {}

  async documentsOf(shareLinkId: string): Promise<PortalDocumentRow[]> {
    const db = this.host.db;
    const rows = await db.shareLinkDocument.findMany({
      // DT-151: an ANULADO document is never served; this is the only point that decides it, so the page, the
      // document, the file, the unlock and the view all answer as for a document outside the link.
      where: { shareLinkId, document: { deletedAt: null, status: { not: 'ANULADO' } } },
      orderBy: [{ order: 'asc' }, { documentId: 'asc' }],
      select: {
        documentId: true,
        order: true,
        accessKeyHash: true,
        version: { select: SERVED },
        document: {
          select: { code: true, title: true, typeId: true, currentVersionId: true },
        },
      },
    });
    const currentIds = rows.flatMap((row) =>
      row.version === null && row.document.currentVersionId ? [row.document.currentVersionId] : [],
    );
    const current =
      currentIds.length > 0
        ? await db.documentVersion.findMany({ where: { id: { in: currentIds } }, select: SERVED })
        : [];
    const currentById = new Map(current.map((version) => [version.id, version]));

    const result: PortalDocumentRow[] = [];
    for (const row of rows) {
      const served: (PortalServedVersion & { documentId: string }) | undefined =
        row.version ??
        (row.document.currentVersionId
          ? currentById.get(row.document.currentVersionId)
          : undefined);
      // A pinned version of another document is never served.
      if (!served || served.documentId !== row.documentId) continue;
      result.push({
        documentId: row.documentId,
        order: row.order,
        requiresKey: row.accessKeyHash !== null,
        code: row.document.code,
        title: row.document.title,
        typeId: row.document.typeId,
        version: {
          id: served.id,
          versionNumber: served.versionNumber,
          format: served.format,
          createdAt: served.createdAt,
        },
      });
    }
    return result;
  }
}
