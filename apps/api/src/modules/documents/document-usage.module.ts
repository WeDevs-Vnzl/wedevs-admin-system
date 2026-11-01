import { Module } from '@nestjs/common';
import { PrismaDocumentTypeUsage } from './infrastructure/prisma-document-type-usage';

/**
 * Exports the adapter behind settings' `DOCUMENT_TYPE_USAGE` (DT-110). It imports nothing from `settings`:
 * `portal.module` and `document-records.module` import `DocumentTypesModule`, so a back edge would be a cycle.
 */
@Module({
  providers: [PrismaDocumentTypeUsage],
  exports: [PrismaDocumentTypeUsage],
})
export class DocumentUsageModule {}
