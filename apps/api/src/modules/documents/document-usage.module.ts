import { Module } from '@nestjs/common';
import { PrismaDocumentTypeSearchDependents } from './infrastructure/document-type-search-dependents.adapter';
import { PrismaDocumentTypeUsage } from './infrastructure/prisma-document-type-usage';

/**
 * Exports the adapters behind settings' `DOCUMENT_TYPE_USAGE` (DT-110) and `DOCUMENT_TYPE_SEARCH_DEPENDENTS`
 * (DT-166). It imports nothing from `settings`:
 * `portal.module` and `document-records.module` import `DocumentTypesModule`, so a back edge would be a cycle.
 */
@Module({
  providers: [PrismaDocumentTypeUsage, PrismaDocumentTypeSearchDependents],
  exports: [PrismaDocumentTypeUsage, PrismaDocumentTypeSearchDependents],
})
export class DocumentUsageModule {}
