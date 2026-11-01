import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import { AUTHORIZATION, UNIT_OF_WORK } from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import type { FileAccessRegistry } from '../platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../platform/application/ports/file-access.port';
import { PlatformModule } from '../platform/platform.module';
import { DocumentRecordsModule } from './document-records.module';
import { DocumentSupport, DocumentViews } from './application/document-support';
import {
  DOCUMENT_VERSION_REPOSITORY,
  type DocumentVersionRepository,
} from './application/ports/document-version.repository.port';
import { PublishVersion } from './application/use-cases/versions/publish-version.use-case';
import {
  GetDocumentVersion,
  ListDocumentVersions,
} from './application/use-cases/versions/read-document-versions.use-cases';
import { RestoreVersion } from './application/use-cases/versions/restore-version.use-case';
import { SaveDraft } from './application/use-cases/versions/save-draft.use-case';
import { UploadVersion } from './application/use-cases/versions/upload-version.use-case';
import { DocumentFileAccessResolver } from './infrastructure/document-file-access.resolver';
import { PrismaDocumentVersionRepository } from './infrastructure/prisma-document-version.repository';
import { DocumentVersionsController } from './interface/http/document-versions.controller';

/**
 * Documents → versions (PRD §8.9.3, HU-18, HU-19): the markdown draft, publish, upload (file or link) and
 * restore of versions, and the version reads. From `onModuleInit` it registers the file claim of a live
 * document's versions in platform's `FileAccessRegistry` (C23, A3). Builds on `DocumentSupport` and
 * `DocumentViews` of the records module. Not imported by `AppModule` or `DocumentsModule` before package 5.1.
 */
@Module({
  imports: [PlatformModule, DocumentRecordsModule],
  controllers: [DocumentVersionsController],
  providers: [
    { provide: DOCUMENT_VERSION_REPOSITORY, useClass: PrismaDocumentVersionRepository },
    {
      provide: ListDocumentVersions,
      useFactory: (
        authorization: AuthorizationPort,
        support: DocumentSupport,
        versions: DocumentVersionRepository,
      ) => new ListDocumentVersions(authorization, support, versions),
      inject: [AUTHORIZATION, DocumentSupport, DOCUMENT_VERSION_REPOSITORY],
    },
    {
      provide: GetDocumentVersion,
      useFactory: (
        authorization: AuthorizationPort,
        support: DocumentSupport,
        versions: DocumentVersionRepository,
      ) => new GetDocumentVersion(authorization, support, versions),
      inject: [AUTHORIZATION, DocumentSupport, DOCUMENT_VERSION_REPOSITORY],
    },
    {
      provide: SaveDraft,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        versions: DocumentVersionRepository,
      ) => new SaveDraft(authorization, uow, support, versions),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport, DOCUMENT_VERSION_REPOSITORY],
    },
    {
      provide: PublishVersion,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        versions: DocumentVersionRepository,
        views: DocumentViews,
      ) => new PublishVersion(authorization, uow, support, versions, views),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DocumentSupport,
        DOCUMENT_VERSION_REPOSITORY,
        DocumentViews,
      ],
    },
    {
      provide: UploadVersion,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        views: DocumentViews,
      ) => new UploadVersion(authorization, uow, support, views),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport, DocumentViews],
    },
    {
      provide: RestoreVersion,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        versions: DocumentVersionRepository,
        views: DocumentViews,
      ) => new RestoreVersion(authorization, uow, support, versions, views),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DocumentSupport,
        DOCUMENT_VERSION_REPOSITORY,
        DocumentViews,
      ],
    },
    {
      provide: DocumentFileAccessResolver,
      useFactory: (versions: DocumentVersionRepository) => new DocumentFileAccessResolver(versions),
      inject: [DOCUMENT_VERSION_REPOSITORY],
    },
  ],
  exports: [DOCUMENT_VERSION_REPOSITORY],
})
export class DocumentVersionsModule implements OnModuleInit {
  constructor(
    @Inject(FILE_ACCESS_REGISTRY) private readonly fileAccess: FileAccessRegistry,
    private readonly fileResolver: DocumentFileAccessResolver,
  ) {}

  onModuleInit(): void {
    this.fileAccess.register(this.fileResolver);
  }
}
