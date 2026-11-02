import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import type { SequencePort } from '../../shared/application/ports/sequence.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  SEARCH_INDEX,
  SEQUENCE,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { FinanceLookups } from '../commercial/application/finance-lookups';
import { NoteLinkTargetRegistry } from '../commercial/application/note-link-target.registry';
import { FinanceLookupsModule } from '../commercial/finance-lookups.module';
import { NotesModule } from '../commercial/notes.module';
import { RESTORE_HANDLER_REGISTRY } from '../platform/application/ports/restore-handler.port';
import type { RestoreHandlerRegistry } from '../platform/application/restore-handler.registry';
import { ReserveFileForAttachment } from '../platform/application/use-cases/reserve-file-for-attachment.use-case';
import { PlatformModule } from '../platform/platform.module';
import { TrashModule } from '../platform/trash.module';
import { DocumentTypeCatalog } from '../settings/application/document-type-catalog';
import { TAGGABLE_TARGET_REGISTRY } from '../settings/application/ports/taggable-target.port';
import { TagAssignments } from '../settings/application/tag-assignments';
import type { TaggableTargetRegistry } from '../settings/application/taggable-target.registry';
import { DocumentTypesModule } from '../settings/document-types.module';
import { TagsModule } from '../settings/tags.module';
import { DocumentSupport, DocumentViews } from './application/document-support';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from './application/ports/document.repository.port';
import {
  ArchiveDocument,
  ArchiveDocuments,
} from './application/use-cases/records/archive-documents.use-case';
import { CreateDocument } from './application/use-cases/records/create-document.use-case';
import {
  LinkDocument,
  UnlinkDocument,
} from './application/use-cases/records/link-document.use-case';
import {
  CountDocumentsByCategory,
  GetDocument,
  ListDocuments,
} from './application/use-cases/records/list-documents.use-case';
import { MarkExpiredDocuments } from './application/use-cases/records/mark-expired-documents.use-case';
import { RestoreDocument } from './application/use-cases/records/restore-document.use-case';
import { SetDocumentStatus } from './application/use-cases/records/set-document-status.use-case';
import { UpdateDocumentMeta } from './application/use-cases/records/update-document-meta.use-case';
import {
  DocumentNoteTargetResolver,
  DocumentRestoreHandler,
  DocumentTaggableResolver,
} from './infrastructure/document-registry.resolvers';
import { PrismaDocumentRepository } from './infrastructure/prisma-document.repository';
import { DocumentsController } from './interface/http/documents.controller';

/**
 * Documents → records (PRD §8.9, HU-18 to HU-20): metadata, statuses, links, tags, search, archive and
 * restore, and the expiry step. From `onModuleInit` it registers the `DOCUMENT` taggable resolver in
 * settings' tag registry, the `DOCUMENT` note target in the note registry and the restore handler in the
 * trash. Exports `DocumentSupport` and `DocumentViews` (the version, share and portal packages build on
 * them), the repository token and `MarkExpiredDocuments` for BE-5's `daily-maintenance`. Not imported by
 * `AppModule` or `DocumentsModule` before package 5.1.
 */
@Module({
  imports: [
    PlatformModule,
    TagsModule,
    TrashModule,
    NotesModule,
    FinanceLookupsModule,
    DocumentTypesModule,
  ],
  controllers: [DocumentsController],
  providers: [
    { provide: DOCUMENT_REPOSITORY, useClass: PrismaDocumentRepository },
    {
      provide: DocumentSupport,
      useFactory: (
        documents: DocumentRepository,
        catalog: DocumentTypeCatalog,
        targets: NoteLinkTargetRegistry,
        lookups: FinanceLookups,
        authorization: AuthorizationPort,
        files: ReserveFileForAttachment,
        activityLog: ActivityLogPort,
        search: SearchIndexPort,
        locks: RowLocksPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) =>
        new DocumentSupport(
          documents,
          catalog,
          targets,
          lookups,
          authorization,
          files,
          activityLog,
          search,
          locks,
          clock,
          ids,
        ),
      inject: [
        DOCUMENT_REPOSITORY,
        DocumentTypeCatalog,
        NoteLinkTargetRegistry,
        FinanceLookups,
        AUTHORIZATION,
        ReserveFileForAttachment,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        ROW_LOCKS,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: DocumentViews,
      useFactory: (
        documents: DocumentRepository,
        tags: TagAssignments,
        catalog: DocumentTypeCatalog,
        targets: NoteLinkTargetRegistry,
        authorization: AuthorizationPort,
        clock: ClockPort,
      ) => new DocumentViews(documents, tags, catalog, targets, authorization, clock),
      inject: [
        DOCUMENT_REPOSITORY,
        TagAssignments,
        DocumentTypeCatalog,
        NoteLinkTargetRegistry,
        AUTHORIZATION,
        CLOCK,
      ],
    },
    {
      provide: ListDocuments,
      useFactory: (
        authorization: AuthorizationPort,
        documents: DocumentRepository,
        views: DocumentViews,
        clock: ClockPort,
      ) => new ListDocuments(authorization, documents, views, clock),
      inject: [AUTHORIZATION, DOCUMENT_REPOSITORY, DocumentViews, CLOCK],
    },
    {
      provide: CountDocumentsByCategory,
      useFactory: (
        authorization: AuthorizationPort,
        documents: DocumentRepository,
        clock: ClockPort,
      ) => new CountDocumentsByCategory(authorization, documents, clock),
      inject: [AUTHORIZATION, DOCUMENT_REPOSITORY, CLOCK],
    },
    {
      provide: GetDocument,
      useFactory: (
        authorization: AuthorizationPort,
        support: DocumentSupport,
        views: DocumentViews,
      ) => new GetDocument(authorization, support, views),
      inject: [AUTHORIZATION, DocumentSupport, DocumentViews],
    },
    {
      provide: CreateDocument,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        tags: TagAssignments,
        sequence: SequencePort,
        views: DocumentViews,
      ) => new CreateDocument(authorization, uow, support, tags, sequence, views),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DocumentSupport,
        TagAssignments,
        SEQUENCE,
        DocumentViews,
      ],
    },
    {
      provide: UpdateDocumentMeta,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        tags: TagAssignments,
        views: DocumentViews,
      ) => new UpdateDocumentMeta(authorization, uow, support, tags, views),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport, TagAssignments, DocumentViews],
    },
    {
      provide: SetDocumentStatus,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        views: DocumentViews,
      ) => new SetDocumentStatus(authorization, uow, support, views),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport, DocumentViews],
    },
    {
      provide: ArchiveDocument,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        search: SearchIndexPort,
      ) => new ArchiveDocument(authorization, uow, support, search),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport, SEARCH_INDEX],
    },
    {
      provide: ArchiveDocuments,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        search: SearchIndexPort,
      ) => new ArchiveDocuments(authorization, uow, support, search),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport, SEARCH_INDEX],
    },
    {
      provide: RestoreDocument,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
      ) => new RestoreDocument(authorization, uow, support),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport],
    },
    {
      provide: LinkDocument,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        views: DocumentViews,
      ) => new LinkDocument(authorization, uow, support, views),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport, DocumentViews],
    },
    {
      provide: UnlinkDocument,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: DocumentSupport,
        views: DocumentViews,
      ) => new UnlinkDocument(authorization, uow, support, views),
      inject: [AUTHORIZATION, UNIT_OF_WORK, DocumentSupport, DocumentViews],
    },
    {
      provide: MarkExpiredDocuments,
      useFactory: (uow: UnitOfWorkPort, support: DocumentSupport) =>
        new MarkExpiredDocuments(uow, support),
      inject: [UNIT_OF_WORK, DocumentSupport],
    },
    {
      provide: DocumentTaggableResolver,
      useFactory: (documents: DocumentRepository, support: DocumentSupport) =>
        new DocumentTaggableResolver(documents, support),
      inject: [DOCUMENT_REPOSITORY, DocumentSupport],
    },
    {
      provide: DocumentNoteTargetResolver,
      useFactory: (documents: DocumentRepository) => new DocumentNoteTargetResolver(documents),
      inject: [DOCUMENT_REPOSITORY],
    },
    {
      provide: DocumentRestoreHandler,
      useFactory: (restore: RestoreDocument) => new DocumentRestoreHandler(restore),
      inject: [RestoreDocument],
    },
  ],
  exports: [
    DOCUMENT_REPOSITORY,
    DocumentSupport,
    DocumentViews,
    ListDocuments,
    MarkExpiredDocuments,
  ],
})
export class DocumentRecordsModule implements OnModuleInit {
  constructor(
    @Inject(RESTORE_HANDLER_REGISTRY) private readonly restoreHandlers: RestoreHandlerRegistry,
    @Inject(TAGGABLE_TARGET_REGISTRY) private readonly taggables: TaggableTargetRegistry,
    @Inject(NoteLinkTargetRegistry) private readonly noteTargets: NoteLinkTargetRegistry,
    private readonly taggableResolver: DocumentTaggableResolver,
    private readonly noteTargetResolver: DocumentNoteTargetResolver,
    private readonly restoreHandler: DocumentRestoreHandler,
  ) {}

  onModuleInit(): void {
    this.taggables.register(this.taggableResolver);
    this.noteTargets.register(this.noteTargetResolver);
    this.restoreHandlers.register(this.restoreHandler);
  }
}
