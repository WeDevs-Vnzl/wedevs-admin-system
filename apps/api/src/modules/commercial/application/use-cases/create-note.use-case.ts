import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { SearchIndexPort } from '../../../../shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import { normalizeNoteTitle, prepareNoteContent } from '../../domain/note';
import { assertDistinctLinks, type NoteLinkTarget } from '../../domain/note-link';
import type { NoteLinkTargetRegistry } from '../note-link-target.registry';
import type { NoteAttachmentFilesPort } from '../ports/note-attachment-files.port';
import type { NoteRepository } from '../ports/note.repository.port';
import {
  noteActivity,
  noteSearchEntry,
  noteTagTarget,
  reserveFiles,
  type NoteDetail,
  type NoteViews,
} from './note-support';

const REQUIRED_KEY = 'validation.required';
/** A note hangs from at most this many records (FE `uniqueTargets(20)`). */
const MAX_LINKS = 20;

export interface CreateNoteInput {
  readonly title?: string | null;
  /** Untrusted Tiptap JSON: it is sanitized here before anything is stored (C4). */
  readonly content: unknown;
  readonly links: readonly NoteLinkTarget[];
  readonly tagIds: readonly string[];
  readonly pinned: boolean;
  readonly attachmentFileIds: readonly string[];
}

/**
 * `POST /notes` (HU-23). Order: `can(create, note)` → validate title, content (allowlist, not blank) and
 * links (at least one, no repeats, every target live through the registry) → one unit of work: reserve
 * every attachment and image file (C23), insert the note with the caller as author, assign tags, record
 * `CREATE` plus one `LINK` per target, upsert the search entry.
 */
export class CreateNote {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly notes: NoteRepository,
    private readonly targets: NoteLinkTargetRegistry,
    private readonly files: NoteAttachmentFilesPort,
    private readonly tags: TagAssignments,
    private readonly activityLog: ActivityLogPort,
    private readonly search: SearchIndexPort,
    private readonly views: NoteViews,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateNoteInput): Promise<NoteDetail> {
    assertCan(this.authorization, actor, 'create', 'note');

    const title = normalizeNoteTitle(input.title);
    const prepared = prepareNoteContent(input.content);
    if (input.links.length === 0 || input.links.length > MAX_LINKS) {
      throw new ValidationFailedError({ fieldErrors: { links: [REQUIRED_KEY] } });
    }
    assertDistinctLinks(input.links);
    const refs = await this.targets.requireLive(
      input.links,
      (index) => `links.${index}.entityType`,
    );

    const id = await this.uow.run(async () => {
      const reserved = await reserveFiles(this.files, actor, [
        ...input.attachmentFileIds,
        ...prepared.imageFileIds,
      ]);
      const noteId = this.ids.next();
      const note = {
        id: noteId,
        title,
        content: prepared.content,
        contentText: prepared.contentText,
      };
      await this.notes.insert({
        ...note,
        authorId: actor.userId,
        pinned: input.pinned,
        links: input.links,
        attachmentFileIds: reserved.map((file) => file.id),
        createdAt: this.clock.now(),
      });
      await this.tags.replace(actor, noteTagTarget(noteId), input.tagIds);

      await this.activityLog.record(noteActivity(actor, note, input.links, 'CREATE'));
      for (const ref of refs) {
        await this.activityLog.record(
          noteActivity(actor, note, input.links, 'LINK', {
            metadata: { entityType: ref.type, entityId: ref.id },
          }),
        );
      }
      await this.search.upsert(noteSearchEntry(note, false));
      return noteId;
    });

    return this.views.detail(await this.require(id));
  }

  private async require(id: string) {
    const note = await this.notes.findById(id);
    if (!note) throw new Error(`Note ${id} vanished after its own commit`);
    return note;
  }
}
