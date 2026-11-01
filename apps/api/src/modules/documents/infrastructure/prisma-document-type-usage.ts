import { Injectable } from '@nestjs/common';
import type { DocumentTypeUsagePort } from '../../settings/application/ports/document-type-usage.port';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

/**
 * Binds settings' `DOCUMENT_TYPE_USAGE` to the `Document` table (DT-110). Archived documents count too: an
 * explicit `deletedAt: undefined` opts out of the soft-delete default (HU-21 CA2).
 *
 * Inside a unit of work (the delete decision) the type row is locked `FOR UPDATE` before counting. A document
 * insert holds a `FOR KEY SHARE` lock on its type through `Document_typeId_fkey`, so the lock waits for an
 * insert in flight, the count then sees it (`typeInUse`), and a later insert waits for the delete. Without
 * it the delete would reach the `ON DELETE RESTRICT` violation as a 500. Plain reads (the `documentCount`
 * of a list) run outside a unit of work and take no lock.
 */
@Injectable()
export class PrismaDocumentTypeUsage implements DocumentTypeUsagePort {
  constructor(private readonly host: TransactionHost) {}

  async countDocuments(typeId: string): Promise<number> {
    const db = this.host.db;
    if (this.host.inTransaction) {
      await db.$queryRaw`SELECT "id" FROM "DocumentType" WHERE "id" = ${typeId} FOR UPDATE`;
    }
    return db.document.count({ where: { typeId, deletedAt: undefined } });
  }
}
