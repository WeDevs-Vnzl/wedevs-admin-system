import { Inject, Injectable } from '@nestjs/common';
import type { SearchIndexPort } from '../../../shared/application/ports/search-index.port';
import { SEARCH_INDEX } from '../../../shared/application/ports/tokens';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { DocumentTypeSearchDependentsPort } from '../../settings/application/ports/document-type-search-dependents.port';

/**
 * Binds settings' `DOCUMENT_TYPE_SEARCH_DEPENDENTS` to the documents' `SearchEntry` rows (DT-166, A15): when a
 * type is renamed, the entry of every document of that type, archived ones included (A11), gets the new name as
 * its `subtitle` (`documentSearchEntry`). It runs inside the rename's `Serializable` unit of work and does
 * database work only, so the unit of work may retry it. Ids are written ascending, in one set-based statement
 * per chunk, so two renames touching the same rows never lock them in opposite orders. Like
 * `PrismaDocumentTypeUsage` it imports nothing from `settings` but the port type.
 */
@Injectable()
export class PrismaDocumentTypeSearchDependents implements DocumentTypeSearchDependentsPort {
  constructor(
    private readonly host: TransactionHost,
    @Inject(SEARCH_INDEX) private readonly search: SearchIndexPort,
  ) {}

  async relabelType(typeId: string, name: string): Promise<number> {
    const documents = await this.host.db.document.findMany({
      where: { typeId, deletedAt: undefined },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return this.search.setTexts(
      'DOCUMENT',
      documents.map((document) => ({ entityId: document.id, subtitle: name })),
    );
  }
}
