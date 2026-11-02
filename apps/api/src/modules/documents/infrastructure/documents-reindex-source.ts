import { Injectable } from '@nestjs/common';
import type { SearchIndexEntry } from '../../../shared/application/ports/search-index.port';
import type { SearchReindexSource } from '../../../shared/application/ports/search-reindex.port';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { documentSearchEntry } from '../application/document-support';

/**
 * Rebuilds the `DOCUMENT` `SearchEntry` from the rows (PRD §12 `ReindexEntity`, A11). It reads through the
 * ambient transaction, so the `Serializable` unit of work of the reindex sees one snapshot, and builds the entry
 * with the same function the write path uses (`documentSearchEntry`): title, code and status of the row, the
 * type name as subtitle, the summary plus the current markdown as body. Archived documents are included
 * (`deletedAt: undefined` opts out of the soft-delete default) with `archived: true`.
 */
@Injectable()
export class DocumentsReindexSource implements SearchReindexSource {
  readonly entityType = 'DOCUMENT' as const;

  constructor(private readonly host: TransactionHost) {}

  async pageIds(afterId: string | null, take: number): Promise<string[]> {
    const rows = await this.host.db.document.findMany({
      where: { deletedAt: undefined, ...(afterId === null ? {} : { id: { gt: afterId } }) },
      orderBy: { id: 'asc' },
      take,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const row = await this.host.db.document.findUnique({
      where: { id, deletedAt: undefined },
      select: {
        id: true,
        code: true,
        title: true,
        summary: true,
        status: true,
        deletedAt: true,
        type: { select: { name: true } },
        currentVersion: { select: { format: true, content: true } },
      },
    });
    if (!row) return null;
    const markdown = row.currentVersion?.format === 'MARKDOWN' ? row.currentVersion.content : null;
    return documentSearchEntry(row, row.type.name, markdown, row.deletedAt !== null);
  }
}
