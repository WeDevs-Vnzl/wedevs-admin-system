import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import { ArchiveNote } from '../../../src/modules/commercial/application/use-cases/archive-note.use-case';
import { AttachNoteFile } from '../../../src/modules/commercial/application/use-cases/attach-note-file.use-case';
import { CreateNote } from '../../../src/modules/commercial/application/use-cases/create-note.use-case';
import { GetNote } from '../../../src/modules/commercial/application/use-cases/get-note.use-case';
import { LinkNote } from '../../../src/modules/commercial/application/use-cases/link-note.use-case';
import { ListNotes } from '../../../src/modules/commercial/application/use-cases/list-notes.use-case';
import { NoteViews } from '../../../src/modules/commercial/application/use-cases/note-support';
import { PinNote } from '../../../src/modules/commercial/application/use-cases/pin-note.use-case';
import { RestoreNote } from '../../../src/modules/commercial/application/use-cases/restore-note.use-case';
import { UnlinkNote } from '../../../src/modules/commercial/application/use-cases/unlink-note.use-case';
import { UpdateNote } from '../../../src/modules/commercial/application/use-cases/update-note.use-case';
import type { NoteFile } from '../../../src/modules/commercial/domain/note';
import { NoteFileAccessResolver } from '../../../src/modules/commercial/infrastructure/note-file-access.resolver';
import { NoteRestoreHandler } from '../../../src/modules/commercial/infrastructure/note-restore.handler';
import { NoteTaggableResolver } from '../../../src/modules/commercial/infrastructure/note-taggable.resolver';
import { PlatformNoteAttachmentFiles } from '../../../src/modules/commercial/infrastructure/platform-note-attachment-files.adapter';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { FileAccessRegistry } from '../../../src/modules/platform/application/file-access.registry';
import { ReserveFileForAttachment } from '../../../src/modules/platform/application/use-cases/reserve-file-for-attachment.use-case';
import type { StoredFile } from '../../../src/modules/platform/domain/file';
import { TagAssignments } from '../../../src/modules/settings/application/tag-assignments';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import type { RichTextDoc } from '../../../src/shared/domain/rich-text';
import { InMemoryFileRepository } from '../../files/in-memory-file.repository';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemorySearchIndex } from '../../support/fakes/in-memory-search-index';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { InMemoryTagAssignmentRepository, InMemoryTagRepository } from '../../settings/tags/fakes';
import { FakeNoteTargets } from './fakes/fake-note-targets';
import { InMemoryNoteRepository } from './fakes/in-memory-note.repository';

export const userOf = (role: UserRole, name = role.toLowerCase()): CurrentUser => ({
  userId: `usr_${name}`,
  clerkId: `clerk_${name}`,
  role,
  email: `${name}@example.test`,
  name,
});
export const owner = userOf('OWNER');
export const admin = userOf('ADMIN');
export const member = userOf('MEMBER');
export const otherMember = userOf('MEMBER', 'other');
export const viewer = userOf('VIEWER');

export const doc = (text: string): RichTextDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
export const imageDoc = (fileId: string, extra: Record<string, unknown> = {}): RichTextDoc => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Con imagen' }] },
    { type: 'image', attrs: { fileId, ...extra } },
  ],
});

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  sort: { field: 'createdAt', direction: 'desc' },
  ...over,
});

/** Every in-memory port of the notes slice wired with the real use cases, the real matrix and platform's real reservation. */
export function createWorld() {
  const clock = new FixedClock('2026-10-30T12:00:00.000Z');
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const search = new InMemorySearchIndex(uow);
  const authorization = new MatrixAuthorization();
  const users = new Map<string, CurrentUser>();
  const fileRepo = new InMemoryFileRepository();
  const fileRegistry = new FileAccessRegistry();
  const assignmentRepo = new InMemoryTagAssignmentRepository(uow);
  const tagRepo = new InMemoryTagRepository(uow, assignmentRepo);
  const tags = new TagAssignments(tagRepo, assignmentRepo);
  const targets = new FakeNoteTargets();
  const targetRegistry = new NoteLinkTargetRegistry(targets);

  const noteFile = (id: string): NoteFile => {
    const file = fileRepo.rows.get(id);
    if (!file) throw new Error(`file ${id} not seeded`);
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      status: file.status,
      uploadedById: file.uploadedById,
      createdAt: file.createdAt,
    };
  };
  const notes = new InMemoryNoteRepository(uow, {
    author: (id) => {
      const user = users.get(id);
      return { id, name: user?.name ?? id, imageUrl: null };
    },
    file: noteFile,
    tagIdsOf: (noteId) => assignmentRepo.committedIds({ entityType: 'NOTE', entityId: noteId }),
  });
  fileRegistry.register(new NoteFileAccessResolver(notes));

  const files = new PlatformNoteAttachmentFiles(
    new ReserveFileForAttachment(authorization, fileRepo, fileRegistry),
  );
  const ids = new SequentialIdGenerator('not');
  const views = new NoteViews(tags, targetRegistry);

  const restoreNote = new RestoreNote(authorization, uow, notes, activity, search, clock);
  return {
    clock,
    uow,
    activity,
    search,
    authorization,
    fileRepo,
    fileRegistry,
    assignmentRepo,
    tagRepo,
    tags,
    targets,
    targetRegistry,
    notes,
    files,
    views,
    restoreNote,
    restoreHandler: new NoteRestoreHandler(restoreNote),
    taggableResolver: new NoteTaggableResolver(notes),
    createNote: new CreateNote(
      authorization,
      uow,
      notes,
      targetRegistry,
      files,
      tags,
      activity,
      search,
      views,
      clock,
      ids,
    ),
    updateNote: new UpdateNote(
      authorization,
      uow,
      notes,
      files,
      tags,
      activity,
      search,
      views,
      clock,
    ),
    pinNote: new PinNote(authorization, uow, notes, activity, views, clock),
    linkNote: new LinkNote(authorization, uow, notes, targetRegistry, activity, views, clock),
    unlinkNote: new UnlinkNote(authorization, uow, notes, activity, views, clock),
    attachFile: new AttachNoteFile(authorization, uow, notes, files, activity, views, clock),
    archiveNote: new ArchiveNote(authorization, uow, notes, activity, search, clock),
    listNotes: new ListNotes(authorization, notes, views),
    getNote: new GetNote(authorization, notes, views),
    addUser(user: CurrentUser): CurrentUser {
      users.set(user.userId, user);
      return user;
    },
    /** A `READY` file uploaded by `by` (pass `status: 'PENDING'` for one that is not). */
    seedFile(id: string, by: CurrentUser, status: StoredFile['status'] = 'READY'): string {
      fileRepo.rows.set(id, {
        id,
        storageKey: `general/2026/10/${id}`,
        bucket: 'memory',
        originalName: `${id}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 100,
        status,
        uploadedById: by.userId,
        createdAt: clock.now(),
        deletedAt: null,
      });
      return id;
    },
    seedTag(id: string, name: string, color = '#112233') {
      tagRepo.seed({ id, name, color, createdAt: new Date('2026-01-01T00:00:00.000Z') });
    },
  };
}
export type World = ReturnType<typeof createWorld>;

/** A world with the four roles, a client, a contact and a project. */
export function seededWorld() {
  const world = createWorld();
  for (const user of [owner, admin, member, otherMember, viewer]) world.addUser(user);
  world.targets.add('CLIENT', 'cli_kairos', 'Kairos');
  world.targets.add('CLIENT', 'cli_solaris', 'Solaris');
  world.targets.add('CONTACT', 'con_ana', 'Ana');
  world.targets.add('PROJECT', 'pry_kairos_web', 'Kairos Web');
  return world;
}
export const KAIROS = { entityType: 'CLIENT', entityId: 'cli_kairos' } as const;
export const SOLARIS = { entityType: 'CLIENT', entityId: 'cli_solaris' } as const;
export const KAIROS_WEB = { entityType: 'PROJECT', entityId: 'pry_kairos_web' } as const;
export const ANA = { entityType: 'CONTACT', entityId: 'con_ana' } as const;

export const newNote = (over: Record<string, unknown> = {}) => ({
  title: 'Nota',
  content: doc('texto'),
  links: [KAIROS],
  tagIds: [] as string[],
  pinned: false,
  attachmentFileIds: [] as string[],
  ...over,
});
