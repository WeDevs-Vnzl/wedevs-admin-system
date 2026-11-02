import { ExportSourceRegistry } from '../../shared/application/ports/export-source.port';
import { SearchReindexRegistry } from '../../shared/application/ports/search-reindex.port';
import { TransactionHost } from '../../shared/infrastructure/prisma/transaction-host';
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  SEARCH_INDEX,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import type { FileAccessRegistry } from '../platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../platform/application/ports/file-access.port';
import { RESTORE_HANDLER_REGISTRY } from '../platform/application/ports/restore-handler.port';
import type { RestoreHandlerRegistry } from '../platform/application/restore-handler.registry';
import { ReserveFileForAttachment } from '../platform/application/use-cases/reserve-file-for-attachment.use-case';
import { PlatformModule } from '../platform/platform.module';
import { TrashModule } from '../platform/trash.module';
import { TAGGABLE_TARGET_REGISTRY } from '../settings/application/ports/taggable-target.port';
import { TagAssignments } from '../settings/application/tag-assignments';
import type { TaggableTargetRegistry } from '../settings/application/taggable-target.registry';
import { TagsModule } from '../settings/tags.module';
import { NoteLinkTargetRegistry } from './application/note-link-target.registry';
import {
  NOTE_ATTACHMENT_FILES,
  type NoteAttachmentFilesPort,
} from './application/ports/note-attachment-files.port';
import { NOTE_TARGET, type NoteTargetPort } from './application/ports/note-target.port';
import { NOTE_REPOSITORY, type NoteRepository } from './application/ports/note.repository.port';
import { ArchiveNote } from './application/use-cases/archive-note.use-case';
import { AttachNoteFile } from './application/use-cases/attach-note-file.use-case';
import { CreateNote } from './application/use-cases/create-note.use-case';
import { GetNote } from './application/use-cases/get-note.use-case';
import { LinkNote } from './application/use-cases/link-note.use-case';
import { ListNotes } from './application/use-cases/list-notes.use-case';
import { NoteViews } from './application/use-cases/note-support';
import { PinNote } from './application/use-cases/pin-note.use-case';
import { RestoreNote } from './application/use-cases/restore-note.use-case';
import { UnlinkNote } from './application/use-cases/unlink-note.use-case';
import { UpdateNote } from './application/use-cases/update-note.use-case';
import { NoteFileAccessResolver } from './infrastructure/note-file-access.resolver';
import { NoteRestoreHandler } from './infrastructure/note-restore.handler';
import { NoteTaggableResolver } from './infrastructure/note-taggable.resolver';
import { PlatformNoteAttachmentFiles } from './infrastructure/platform-note-attachment-files.adapter';
import { PrismaNoteTargetAdapter } from './infrastructure/prisma-note-target.adapter';
import { NoteReindexSource } from './infrastructure/commercial-reindex-sources';
import { NoteExportSource } from './infrastructure/commercial-export-sources';
import { PrismaNoteRepository } from './infrastructure/prisma-note.repository';
import { NotesController } from './interface/http/notes.controller';

/**
 * Notes (PRD §8.10, HU-23). Registers, from `onModuleInit`, the restore handler `NOTE` in the trash, the
 * taggable resolver `NOTE` in settings' tag registry and the file resolver in platform's
 * `FileAccessRegistry` (a file of a live note downloads with `read` on notes). Exports
 * `NoteLinkTargetRegistry`: BE-3 and BE-4 register the invoice, payment, expense and document targets
 * there. Not imported by `AppModule` before package 4.1.
 */
@Module({
  imports: [PlatformModule, TagsModule, TrashModule],
  controllers: [NotesController],
  providers: [
    { provide: NOTE_REPOSITORY, useClass: PrismaNoteRepository },
    { provide: NOTE_TARGET, useClass: PrismaNoteTargetAdapter },
    {
      provide: NOTE_ATTACHMENT_FILES,
      useFactory: (reserve: ReserveFileForAttachment) => new PlatformNoteAttachmentFiles(reserve),
      inject: [ReserveFileForAttachment],
    },
    {
      provide: NoteLinkTargetRegistry,
      useFactory: (own: NoteTargetPort) => new NoteLinkTargetRegistry(own),
      inject: [NOTE_TARGET],
    },
    {
      provide: NoteViews,
      useFactory: (tags: TagAssignments, targets: NoteLinkTargetRegistry) =>
        new NoteViews(tags, targets),
      inject: [TagAssignments, NoteLinkTargetRegistry],
    },
    {
      provide: ListNotes,
      useFactory: (authorization: AuthorizationPort, notes: NoteRepository, views: NoteViews) =>
        new ListNotes(authorization, notes, views),
      inject: [AUTHORIZATION, NOTE_REPOSITORY, NoteViews],
    },
    {
      provide: GetNote,
      useFactory: (authorization: AuthorizationPort, notes: NoteRepository, views: NoteViews) =>
        new GetNote(authorization, notes, views),
      inject: [AUTHORIZATION, NOTE_REPOSITORY, NoteViews],
    },
    {
      provide: CreateNote,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        notes: NoteRepository,
        targets: NoteLinkTargetRegistry,
        files: NoteAttachmentFilesPort,
        tags: TagAssignments,
        activityLog: ActivityLogPort,
        search: SearchIndexPort,
        views: NoteViews,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) =>
        new CreateNote(
          authorization,
          uow,
          notes,
          targets,
          files,
          tags,
          activityLog,
          search,
          views,
          clock,
          ids,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        NOTE_REPOSITORY,
        NoteLinkTargetRegistry,
        NOTE_ATTACHMENT_FILES,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        NoteViews,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: UpdateNote,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        notes: NoteRepository,
        files: NoteAttachmentFilesPort,
        tags: TagAssignments,
        activityLog: ActivityLogPort,
        search: SearchIndexPort,
        views: NoteViews,
        clock: ClockPort,
      ) =>
        new UpdateNote(authorization, uow, notes, files, tags, activityLog, search, views, clock),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        NOTE_REPOSITORY,
        NOTE_ATTACHMENT_FILES,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        NoteViews,
        CLOCK,
      ],
    },
    {
      provide: PinNote,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        notes: NoteRepository,
        activityLog: ActivityLogPort,
        views: NoteViews,
        clock: ClockPort,
      ) => new PinNote(authorization, uow, notes, activityLog, views, clock),
      inject: [AUTHORIZATION, UNIT_OF_WORK, NOTE_REPOSITORY, ACTIVITY_LOG, NoteViews, CLOCK],
    },
    {
      provide: LinkNote,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        notes: NoteRepository,
        targets: NoteLinkTargetRegistry,
        activityLog: ActivityLogPort,
        views: NoteViews,
        clock: ClockPort,
      ) => new LinkNote(authorization, uow, notes, targets, activityLog, views, clock),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        NOTE_REPOSITORY,
        NoteLinkTargetRegistry,
        ACTIVITY_LOG,
        NoteViews,
        CLOCK,
      ],
    },
    {
      provide: UnlinkNote,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        notes: NoteRepository,
        activityLog: ActivityLogPort,
        views: NoteViews,
        clock: ClockPort,
      ) => new UnlinkNote(authorization, uow, notes, activityLog, views, clock),
      inject: [AUTHORIZATION, UNIT_OF_WORK, NOTE_REPOSITORY, ACTIVITY_LOG, NoteViews, CLOCK],
    },
    {
      provide: AttachNoteFile,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        notes: NoteRepository,
        files: NoteAttachmentFilesPort,
        activityLog: ActivityLogPort,
        views: NoteViews,
        clock: ClockPort,
      ) => new AttachNoteFile(authorization, uow, notes, files, activityLog, views, clock),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        NOTE_REPOSITORY,
        NOTE_ATTACHMENT_FILES,
        ACTIVITY_LOG,
        NoteViews,
        CLOCK,
      ],
    },
    {
      provide: ArchiveNote,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        notes: NoteRepository,
        activityLog: ActivityLogPort,
        search: SearchIndexPort,
        clock: ClockPort,
      ) => new ArchiveNote(authorization, uow, notes, activityLog, search, clock),
      inject: [AUTHORIZATION, UNIT_OF_WORK, NOTE_REPOSITORY, ACTIVITY_LOG, SEARCH_INDEX, CLOCK],
    },
    {
      provide: RestoreNote,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        notes: NoteRepository,
        activityLog: ActivityLogPort,
        search: SearchIndexPort,
        clock: ClockPort,
      ) => new RestoreNote(authorization, uow, notes, activityLog, search, clock),
      inject: [AUTHORIZATION, UNIT_OF_WORK, NOTE_REPOSITORY, ACTIVITY_LOG, SEARCH_INDEX, CLOCK],
    },
    {
      provide: NoteFileAccessResolver,
      useFactory: (notes: NoteRepository) => new NoteFileAccessResolver(notes),
      inject: [NOTE_REPOSITORY],
    },
    {
      provide: NoteRestoreHandler,
      useFactory: (restore: RestoreNote) => new NoteRestoreHandler(restore),
      inject: [RestoreNote],
    },
    {
      provide: NoteTaggableResolver,
      useFactory: (notes: NoteRepository) => new NoteTaggableResolver(notes),
      inject: [NOTE_REPOSITORY],
    },
  ],
  exports: [NoteLinkTargetRegistry],
})
export class NotesModule implements OnModuleInit {
  constructor(
    @Inject(FILE_ACCESS_REGISTRY) private readonly fileAccess: FileAccessRegistry,
    @Inject(RESTORE_HANDLER_REGISTRY) private readonly restoreHandlers: RestoreHandlerRegistry,
    @Inject(TAGGABLE_TARGET_REGISTRY) private readonly taggables: TaggableTargetRegistry,
    private readonly fileResolver: NoteFileAccessResolver,
    private readonly restoreHandler: NoteRestoreHandler,
    private readonly taggableResolver: NoteTaggableResolver,
    @Inject(SearchReindexRegistry) private readonly reindexRegistry: SearchReindexRegistry,
    @Inject(ExportSourceRegistry) private readonly exportRegistry: ExportSourceRegistry,
    @Inject(TransactionHost) private readonly host: TransactionHost,
    @Inject(NOTE_REPOSITORY) private readonly notes: NoteRepository,
    private readonly listNotes: ListNotes,
  ) {}

  onModuleInit(): void {
    this.fileAccess.register(this.fileResolver);
    this.restoreHandlers.register(this.restoreHandler);
    this.taggables.register(this.taggableResolver);
    this.reindexRegistry.register(new NoteReindexSource(this.host, this.notes));
    this.exportRegistry.register(new NoteExportSource(this.listNotes));
  }
}
