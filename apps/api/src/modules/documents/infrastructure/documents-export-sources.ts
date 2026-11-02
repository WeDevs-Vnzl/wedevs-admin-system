import type { CurrentUser } from '../../../shared/application/current-user';
import type {
  ExportColumn,
  ExportPage,
  ExportSource,
} from '../../../shared/application/ports/export-source.port';
import type { ListQuery } from '../../../shared/domain/list-query';
import type { DocumentListRow } from '../application/document-support';
import type { ListDocuments } from '../application/use-cases/records/list-documents.use-case';

/**
 * The documents table as a CSV export source (DT-171). The columns are the table's own
 * (`DOCUMENT_COLUMN_IDS` of the FE); every cell comes from the list row, which holds metadata only, so no
 * `File` key, storage key, asset URL or file name can reach a cell (C23). The rows come from `ListDocuments`
 * with the caller's own authorization and the same query, so the export is exactly what the list shows.
 */
export class DocumentsExportSource implements ExportSource<DocumentListRow> {
  readonly entity = 'DOCUMENT';

  readonly columns: Readonly<Record<string, ExportColumn<DocumentListRow>>> = {
    code: { type: 'text', value: (row) => row.code },
    title: { type: 'text', value: (row) => row.title },
    category: { type: 'text', value: (row) => row.category.name },
    type: { type: 'text', value: (row) => row.type.name },
    status: { type: 'text', value: (row) => row.status },
    format: { type: 'text', value: (row) => row.currentFormat },
    versionNumber: { type: 'integer', value: (row) => row.currentVersionNumber },
    links: { type: 'text', value: (row) => row.links.map((link) => link.label).join('; ') },
    expiresAt: { type: 'date', value: (row) => row.expiresAt },
    shared: { type: 'boolean', value: (row) => row.isShared },
    updatedAt: { type: 'datetime', value: (row) => row.updatedAt },
  };

  constructor(private readonly listDocuments: Pick<ListDocuments, 'execute'>) {}

  async read(
    actor: CurrentUser,
    query: Omit<ListQuery, 'page' | 'pageSize'>,
    page: ExportPage,
  ): Promise<{ rows: readonly DocumentListRow[]; total: number }> {
    const result = await this.listDocuments.execute(actor, {
      ...query,
      page: page.page,
      pageSize: page.pageSize,
    });
    return { rows: result.items, total: result.total };
  }
}
