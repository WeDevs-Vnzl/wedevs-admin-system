import type {
  NewNote,
  NoteContentUpdate,
  NoteListCriteria,
  NoteRepository,
} from '../../../../src/modules/commercial/application/ports/note.repository.port';
import type {
  NoteAuthor,
  NoteFile,
  NoteRecord,
} from '../../../../src/modules/commercial/domain/note';
import {
  sameLink,
  NOTE_ALREADY_LINKED_KEY,
  type NoteLinkTarget,
} from '../../../../src/modules/commercial/domain/note-link';
import { ConflictError } from '../../../../src/shared/domain/domain-error';
import { foldText } from '../../../../src/shared/domain/list-query';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

export interface InMemoryNoteDeps {
  author(id: string): NoteAuthor;
  file(id: string): NoteFile;
  tagIdsOf(noteId: string): string[];
}

const copy = (rows: Map<string, NoteRecord>) => new Map(rows);

/** `Note` rows in memory with the committed/pending split of the unit of work. */
export class InMemoryNoteRepository implements NoteRepository, TransactionParticipant {
  private committed = new Map<string, NoteRecord>();
  private pending = new Map<string, NoteRecord>();
  readonly locked: string[] = [];

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    private readonly deps: InMemoryNoteDeps,
  ) {
    uow.enlist(this);
  }

  private get source(): Map<string, NoteRecord> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  get rows(): NoteRecord[] {
    return [...this.committed.values()];
  }

  private put(note: NoteRecord): void {
    this.pending.set(note.id, note);
  }

  async insert(note: NewNote): Promise<void> {
    this.uow.assertActive('NoteRepository.insert');
    this.put({
      id: note.id,
      title: note.title,
      content: note.content,
      contentText: note.contentText,
      author: this.deps.author(note.authorId),
      pinned: note.pinned,
      links: [...note.links],
      attachments: note.attachmentFileIds.map((id) => this.deps.file(id)),
      createdAt: note.createdAt,
      updatedAt: note.createdAt,
      deletedAt: null,
    });
  }

  async findById(id: string): Promise<NoteRecord | null> {
    return this.source.get(id) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<NoteRecord | null> {
    this.uow.assertActive('NoteRepository.findByIdForUpdate');
    this.locked.push(id);
    return this.source.get(id) ?? null;
  }

  async list(criteria: NoteListCriteria): Promise<Paginated<NoteRecord>> {
    const { query } = criteria;
    let rows = [...this.source.values()]
      .filter((n) =>
        query.archived === 'include'
          ? true
          : query.archived === 'only'
            ? !!n.deletedAt
            : !n.deletedAt,
      )
      .filter((n) => criteria.authorIds.length === 0 || criteria.authorIds.includes(n.author.id))
      .filter(
        (n) =>
          criteria.tagIds.length === 0 ||
          this.deps.tagIdsOf(n.id).some((id) => criteria.tagIds.includes(id)),
      )
      .filter(
        (n) =>
          criteria.linkedEntityTypes.length === 0 ||
          n.links.some((l) => criteria.linkedEntityTypes.includes(l.entityType)),
      )
      .filter((n) => {
        const { entity } = criteria;
        return !entity || n.links.some((l) => sameLink(l, entity));
      })
      .filter((n) => criteria.pinned === null || n.pinned === criteria.pinned)
      .filter((n) => !criteria.createdFrom || n.createdAt >= criteria.createdFrom)
      .filter((n) => !criteria.createdBefore || n.createdAt < criteria.createdBefore);
    if (query.q) {
      const needle = foldText(query.q);
      rows = rows.filter((n) => foldText(`${n.title ?? ''} ${n.contentText}`).includes(needle));
    }
    const sort = query.sort ?? { field: 'createdAt', direction: 'desc' as const };
    const dir = sort.direction === 'asc' ? 1 : -1;
    const key = (n: NoteRecord): string =>
      sort.field === 'title'
        ? (n.title ?? '').toLowerCase()
        : sort.field === 'updatedAt'
          ? n.updatedAt.toISOString()
          : sort.field === 'pinned'
            ? `${n.pinned ? 1 : 0}${n.createdAt.toISOString()}`
            : n.createdAt.toISOString();
    rows.sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : a.id < b.id ? -1 : 1));
    const start = (query.page - 1) * query.pageSize;
    return paginated(rows.slice(start, start + query.pageSize), rows.length, query);
  }

  async updateContent(id: string, update: NoteContentUpdate): Promise<void> {
    this.uow.assertActive('NoteRepository.updateContent');
    const note = this.must(id);
    this.put({ ...note, ...update });
  }

  async setPinned(id: string, pinned: boolean, updatedAt: Date): Promise<void> {
    this.uow.assertActive('NoteRepository.setPinned');
    this.put({ ...this.must(id), pinned, updatedAt });
  }

  async addLink(id: string, target: NoteLinkTarget, at: Date): Promise<void> {
    this.uow.assertActive('NoteRepository.addLink');
    const note = this.must(id);
    if (note.links.some((l) => sameLink(l, target))) {
      throw new ConflictError({ message: NOTE_ALREADY_LINKED_KEY });
    }
    this.put({ ...note, links: [...note.links, target], updatedAt: at });
  }

  async removeLink(id: string, target: NoteLinkTarget, at: Date): Promise<boolean> {
    this.uow.assertActive('NoteRepository.removeLink');
    const note = this.must(id);
    const links = note.links.filter((l) => !sameLink(l, target));
    if (links.length === note.links.length) return false;
    this.put({ ...note, links, updatedAt: at });
    return true;
  }

  async addAttachments(id: string, fileIds: readonly string[], at: Date): Promise<void> {
    this.uow.assertActive('NoteRepository.addAttachments');
    const note = this.must(id);
    const known = new Set(note.attachments.map((f) => f.id));
    const added = fileIds.filter((f) => !known.has(f)).map((f) => this.deps.file(f));
    this.put({ ...note, attachments: [...note.attachments, ...added], updatedAt: at });
  }

  async archive(id: string, at: Date): Promise<void> {
    this.uow.assertActive('NoteRepository.archive');
    this.put({ ...this.must(id), deletedAt: at });
  }

  async restore(id: string, at: Date): Promise<void> {
    this.uow.assertActive('NoteRepository.restore');
    this.put({ ...this.must(id), deletedAt: null, updatedAt: at });
  }

  async isFileAttachedToLiveNote(fileId: string): Promise<boolean> {
    return [...this.source.values()].some(
      (n) => !n.deletedAt && n.attachments.some((f) => f.id === fileId),
    );
  }

  private must(id: string): NoteRecord {
    const note = this.pending.get(id) ?? this.committed.get(id);
    if (!note) throw new Error(`note ${id} not found in the fake`);
    return note;
  }

  begin(): void {
    this.pending = copy(this.committed);
  }
  commit(): void {
    this.committed = this.pending;
  }
  rollback(): void {
    this.pending = copy(this.committed);
  }
}
