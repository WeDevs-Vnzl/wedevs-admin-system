import { Module } from '@nestjs/common';
import { DocumentRecordsModule } from './document-records.module';
import { DocumentVersionsModule } from './document-versions.module';
import { PortalModule } from './portal.module';
import { ShareLinksModule } from './share-links.module';

/**
 * Documents aggregator (PRD §8.9, §8.11): documents, versions, share links and the public portal. Each
 * sub-module owns its providers and controllers; this module only composes them for `AppModule`.
 */
@Module({
  imports: [DocumentRecordsModule, DocumentVersionsModule, ShareLinksModule, PortalModule],
})
export class DocumentsModule {}
