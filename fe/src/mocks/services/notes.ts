// MOCK — note services of Hito 1 (PRD §12 `notes`, §8.10; C8, C9, C11, C12, C19). `fn(ctx, input)`,
// framework-free. Rows are `NoteRow` (author, tag, link and file ids: PD-3) and are assembled into DTOs
// on read, so a renamed client or tag never goes stale. Link targets are resolved with `resolveEntityRef`
// (never through another service). Activity goes through `mockTx` + `logActivity`. Replaced by
// `src/server/services/notes.service.ts` in Hito 2 (C9).
import { toDateOnly } from "@/lib/dates";
import { diffFields } from "@/lib/activity-diff";
import { noteDisplayTitle, richTextExcerpt, richTextToPlainText } from "@/lib/rich-text";
import {
  paginated,
  VALIDATION_MESSAGES,
  type EntityRef,
  type Paginated,
} from "@/lib/validators/common";
import type {
  ArchiveNoteInput,
  AttachFileInput,
  CreateNoteInput,
  LinkNoteInput,
  NoteDetailDTO,
  NoteFilter,
  NoteIdInput,
  NoteLinkTarget,
  NoteListRowDTO,
  PinNoteInput,
  UnlinkNoteInput,
  UpdateNoteInput,
} from "@/lib/validators/notes";
import type { ArchivedRecordDTO } from "@/lib/validators/trash";
import { can } from "@/server/auth/permissions";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { resolveEntityRef } from "../entity-refs";
import { nextMockId } from "../ids";
import type { MockStore, NoteRow } from "../store";
import { logActivity, mockTx, type MockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

/** Characters of the collapsed card preview. */
export const NOTE_EXCERPT_LENGTH = 240;

// ───────────────────────────── Assembly ─────────────────────────────

function refOf(db: MockStore, target: NoteLinkTarget): EntityRef | null {
  return resolveEntityRef(db, target.entityType, target.entityId);
}

function linkRefs(db: MockStore, row: NoteRow): EntityRef[] {
  return row.links.flatMap((target) => {
    const ref = refOf(db, target);
    return ref ? [ref] : [];
  });
}

function authorOf(db: MockStore, row: NoteRow) {
  const user = db.users.find((item) => item.id === row.authorId);
  return { id: row.authorId, name: user?.name ?? row.authorId, imageUrl: user?.imageUrl ?? null };
}

function tagChips(db: MockStore, row: NoteRow) {
  return row.tagIds.flatMap((id) => {
    const tag = db.tags.find((item) => item.id === id);
    return tag ? [{ id: tag.id, name: tag.name, color: tag.color }] : [];
  });
}

function toDetail(db: MockStore, row: NoteRow): NoteDetailDTO {
  const { authorId, tagIds, links, attachmentFileIds, deletedById, ...rest } = row;
  void authorId;
  void tagIds;
  void links;
  void deletedById;
  return structuredClone({
    ...rest,
    contentText: richTextToPlainText(row.content),
    author: authorOf(db, row),
    tags: tagChips(db, row),
    links: linkRefs(db, row),
    attachments: attachmentFileIds.flatMap((id) => {
      const file = db.files.find((item) => item.id === id);
      return file ? [file] : [];
    }),
  });
}

function toListRow(db: MockStore, row: NoteRow): NoteListRowDTO {
  return {
    id: row.id,
    title: row.title,
    excerpt: richTextExcerpt(row.content, NOTE_EXCERPT_LENGTH),
    author: authorOf(db, row),
    pinned: row.pinned,
    tags: tagChips(db, row),
    links: linkRefs(db, row),
    attachmentCount: row.attachmentFileIds.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

function findNote(db: MockStore, id: string, options: { archived?: boolean } = {}): NoteRow {
  const row = db.notes.find((item) => item.id === id);
  if (!row || (row.archivedAt && !options.archived)) throw new ServiceError("NOT_FOUND");
  return row;
}

/** Whether the target record is archived (`resolveEntityRef` still resolves archived rows). */
function isArchivedTarget(db: MockStore, target: NoteLinkTarget): boolean {
  const collections: Partial<
    Record<string, readonly { id: string; archivedAt?: string | null }[]>
  > = {
    CLIENT: db.clients,
    CONTACT: db.contacts,
    PROJECT: db.projects,
    DOCUMENT: db.documents,
    NOTE: db.notes,
  };
  const row = collections[target.entityType]?.find((item) => item.id === target.entityId);
  return Boolean(row?.archivedAt);
}

/** A record a note may hang from: it must exist and not be archived (C14/C19), both answer `NOT_FOUND`. */
function requireTarget(db: MockStore, target: NoteLinkTarget): EntityRef {
  const ref = refOf(db, target);
  if (!ref || isArchivedTarget(db, target)) throw new ServiceError("NOT_FOUND");
  return ref;
}

/** `fileId` of every `image` node of a rich-text document (C4: images are uploaded files). */
function imageFileIds(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (typeof node !== "object" || node === null) return found;
  const { type, attrs, content } = node as {
    type?: unknown;
    attrs?: { fileId?: unknown };
    content?: unknown;
  };
  if (type === "image" && typeof attrs?.fileId === "string") found.add(attrs.fileId);
  if (Array.isArray(content)) for (const child of content) imageFileIds(child, found);
  return found;
}

/** The note's attachments plus the images of its content (all must be `READY`, C14/C23). */
function withContentImages(
  db: MockStore,
  content: unknown,
  attachmentFileIds: readonly string[],
): string[] {
  const ids = [...imageFileIds(content)];
  requireReadyFiles(db, ids);
  return [...new Set([...attachmentFileIds, ...ids])];
}

/** Attachments must be `READY` files; an unknown, `PENDING` or `FAILED` one is refused. */
function requireReadyFiles(db: MockStore, ids: readonly string[]): void {
  for (const id of ids) {
    const file = db.files.find((item) => item.id === id);
    if (!file) throw new ServiceError("NOT_FOUND");
    if (file.status !== "READY") {
      throw new ServiceError("VALIDATION", {
        fieldErrors: { attachmentFileIds: [VALIDATION_MESSAGES.invalidOption] },
      });
    }
  }
}

function label(row: NoteRow): string {
  return noteDisplayTitle(row.title, row.content) || row.id;
}

async function logNote(
  tx: MockTx,
  ctx: MockServiceContext,
  row: NoteRow,
  entry: {
    action: "CREATE" | "UPDATE" | "DELETE" | "LINK" | "UNLINK" | "UPLOAD";
    changes?: ReturnType<typeof diffFields>;
    metadata?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await logActivity(tx, {
    actorType: "USER",
    actorId: ctx.user.id,
    action: entry.action,
    entityType: "NOTE",
    entityId: row.id,
    entityLabel: label(row),
    ...(entry.changes ? { changes: entry.changes } : {}),
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
  });
}

/** The shape `diffFields` compares: the content is a long text, so only "changed" is recorded. */
function diffable(db: MockStore, row: NoteRow) {
  const tagNames = row.tagIds
    .map((id) => db.tags.find((tag) => tag.id === id)?.name ?? id)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  return {
    title: row.title,
    content: JSON.stringify(row.content),
    tagIds: tagNames.join(", "),
  };
}

// ───────────────────────────── Mutations ─────────────────────────────

export async function createNote(
  ctx: MockServiceContext,
  input: CreateNoteInput,
): Promise<NoteDetailDTO> {
  const refs = input.links.map((target) => requireTarget(ctx.db, target));
  requireReadyFiles(ctx.db, input.attachmentFileIds);
  const attachmentFileIds = withContentImages(ctx.db, input.content, input.attachmentFileIds);
  for (const id of input.tagIds) {
    if (!ctx.db.tags.some((tag) => tag.id === id)) throw new ServiceError("NOT_FOUND");
  }

  const notes = ctx.db.notes;
  const now = ctx.now.toISOString();
  const row: NoteRow = {
    id: nextMockId(ctx.db.idCounters, "not", (id) => notes.some((item) => item.id === id)),
    title: input.title ?? null,
    content: structuredClone(input.content),
    authorId: ctx.user.id,
    pinned: input.pinned,
    tagIds: [...input.tagIds],
    links: input.links.map((target) => ({ ...target })),
    attachmentFileIds,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedById: null,
  };
  notes.push(row);

  const tx = mockTx(ctx);
  await logNote(tx, ctx, row, { action: "CREATE" });
  for (const ref of refs) {
    await logNote(tx, ctx, row, {
      action: "LINK",
      metadata: { entityType: ref.type, entityId: ref.id },
    });
  }
  return toDetail(ctx.db, row);
}

export async function updateNote(
  ctx: MockServiceContext,
  input: UpdateNoteInput,
): Promise<NoteDetailDTO> {
  const row = findNote(ctx.db, input.id);
  for (const id of input.tagIds) {
    if (!ctx.db.tags.some((tag) => tag.id === id)) throw new ServiceError("NOT_FOUND");
  }
  const attachmentFileIds = withContentImages(ctx.db, input.content, row.attachmentFileIds);
  const before = diffable(ctx.db, row);
  // The author never changes: `authorId` is not an input and is never written here.
  row.title = input.title ?? null;
  row.content = structuredClone(input.content);
  row.tagIds = [...input.tagIds];
  row.attachmentFileIds = attachmentFileIds;
  const changes = diffFields(before, diffable(ctx.db, row), {
    fields: ["title", "content", "tagIds"],
    longText: ["content"],
  });
  if (changes) {
    row.updatedAt = ctx.now.toISOString();
    await logNote(mockTx(ctx), ctx, row, { action: "UPDATE", changes });
  }
  return toDetail(ctx.db, row);
}

export async function pinNote(
  ctx: MockServiceContext,
  input: PinNoteInput,
): Promise<NoteDetailDTO> {
  const row = findNote(ctx.db, input.id);
  if (row.pinned !== input.pinned) {
    const before = { pinned: row.pinned };
    row.pinned = input.pinned;
    row.updatedAt = ctx.now.toISOString();
    const changes = diffFields(before, { pinned: row.pinned }, { fields: ["pinned"] });
    await logNote(mockTx(ctx), ctx, row, { action: "UPDATE", ...(changes ? { changes } : {}) });
  }
  return toDetail(ctx.db, row);
}

export async function linkNote(
  ctx: MockServiceContext,
  input: LinkNoteInput,
): Promise<NoteDetailDTO> {
  const row = findNote(ctx.db, input.noteId);
  const ref = requireTarget(ctx.db, input.target);
  const exists = row.links.some(
    (link) =>
      link.entityType === input.target.entityType && link.entityId === input.target.entityId,
  );
  if (exists) {
    throw new ServiceError("CONFLICT", { message: "notes.errors.alreadyLinked", entity: ref });
  }
  row.links.push({ ...input.target });
  row.updatedAt = ctx.now.toISOString();
  await logNote(mockTx(ctx), ctx, row, {
    action: "LINK",
    metadata: { entityType: ref.type, entityId: ref.id },
  });
  return toDetail(ctx.db, row);
}

export async function unlinkNote(
  ctx: MockServiceContext,
  input: UnlinkNoteInput,
): Promise<NoteDetailDTO> {
  const row = findNote(ctx.db, input.noteId);
  const index = row.links.findIndex(
    (link) =>
      link.entityType === input.target.entityType && link.entityId === input.target.entityId,
  );
  if (index === -1) throw new ServiceError("NOT_FOUND");
  // A note hangs from at least one record.
  if (row.links.length === 1) {
    throw new ServiceError("INTEGRITY_LOCK", { message: "notes.errors.lastLink" });
  }
  row.links.splice(index, 1);
  row.updatedAt = ctx.now.toISOString();
  await logNote(mockTx(ctx), ctx, row, {
    action: "UNLINK",
    metadata: { entityType: input.target.entityType, entityId: input.target.entityId },
  });
  return toDetail(ctx.db, row);
}

export async function attachFile(
  ctx: MockServiceContext,
  input: AttachFileInput,
): Promise<NoteDetailDTO> {
  const row = findNote(ctx.db, input.noteId);
  requireReadyFiles(ctx.db, [input.fileId]);
  if (!row.attachmentFileIds.includes(input.fileId)) {
    row.attachmentFileIds.push(input.fileId);
    row.updatedAt = ctx.now.toISOString();
    const file = ctx.db.files.find((item) => item.id === input.fileId);
    await logNote(mockTx(ctx), ctx, row, {
      action: "UPLOAD",
      metadata: { fileId: input.fileId, fileName: file?.originalName ?? null },
    });
  }
  return toDetail(ctx.db, row);
}

/** Soft delete (C19). Members archive only their own notes (PRD §4.3): checked here as well as in the adapter. */
export async function archiveNote(
  ctx: MockServiceContext,
  input: ArchiveNoteInput,
): Promise<ArchivedRecordDTO> {
  const row = findNote(ctx.db, input.id);
  if (!can(ctx.user, "delete", "note", { ownerId: row.authorId })) {
    throw new ServiceError("FORBIDDEN");
  }
  row.archivedAt = ctx.now.toISOString();
  row.deletedById = ctx.user.id;
  await logNote(mockTx(ctx), ctx, row, { action: "DELETE" });
  return { id: row.id, archivedAt: row.archivedAt };
}

// ───────────────────────────── Reads ─────────────────────────────

function sameTarget(link: NoteLinkTarget, type: string, id: string): boolean {
  return link.entityType === type && link.entityId === id;
}

const tableSpec: ListSpec<{ row: NoteRow; dto: NoteListRowDTO }> = {
  searchText: ({ row, dto }) => [
    dto.title,
    richTextToPlainText(row.content),
    dto.author.name,
    ...dto.tags.map((tag) => tag.name),
    ...dto.links.map((link) => link.label),
  ],
  sorters: {
    createdAt: ({ dto }) => dto.createdAt,
    updatedAt: ({ dto }) => dto.updatedAt,
    title: ({ row, dto }) => noteDisplayTitle(dto.title, row.content),
    pinned: ({ dto }) => `${dto.pinned ? 1 : 0}${dto.createdAt}`,
    // Entity feed: pinned first, then newest.
    feed: ({ dto }) => `${dto.pinned ? 1 : 0}${dto.createdAt}`,
  },
  defaultSort: "createdAt:desc",
};

/**
 * Notes of the table (`/notes`) or the feed of one record (`entityType` + `entityId`: pinned first, then
 * newest). Archived notes are listed only on request and only for roles that may restore (Owner, Admin).
 */
export async function listNotes(
  ctx: MockServiceContext,
  input: NoteFilter,
): Promise<Paginated<NoteListRowDTO>> {
  const includeArchived = input.includeArchived && can(ctx.user, "restore", "trash");
  const from = input.createdFrom;
  const to = input.createdTo;

  const rows = ctx.db.notes
    .filter((row) => includeArchived || !row.archivedAt)
    .filter((row) => !input.authorId || input.authorId.includes(row.authorId))
    .filter((row) => !input.tagId || input.tagId.some((id) => row.tagIds.includes(id)))
    .filter(
      (row) =>
        !input.linkedEntityType ||
        row.links.some((link) => input.linkedEntityType?.includes(link.entityType)),
    )
    .filter(
      (row) =>
        !input.entityType ||
        (input.entityId !== undefined &&
          row.links.some((link) => sameTarget(link, input.entityType!, input.entityId!))),
    )
    .filter((row) => input.pinned === undefined || row.pinned === Boolean(input.pinned))
    .filter((row) => {
      const day = toDateOnly(new Date(row.createdAt));
      return (!from || day >= from) && (!to || day <= to);
    })
    .map((row) => ({ row, dto: toListRow(ctx.db, row) }));

  const isFeed = input.entityType !== undefined;
  const page = listRows(
    rows,
    input,
    isFeed && !input.sort ? { ...tableSpec, defaultSort: "feed:desc" } : tableSpec,
  );
  return paginated(
    page.items.map((item) => item.dto),
    page.total,
    input,
  );
}

/** One note. An archived note is readable by id only for roles that may restore (C19), like `getClient`. */
export async function getNote(ctx: MockServiceContext, input: NoteIdInput): Promise<NoteDetailDTO> {
  const row = findNote(ctx.db, input.id, { archived: true });
  if (row.archivedAt && !can(ctx.user, "restore", "trash")) throw new ServiceError("NOT_FOUND");
  return toDetail(ctx.db, row);
}
