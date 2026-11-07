"use server";

import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { apiAction } from "@/lib/api/action";
import type {
  ArchivedNoteDto,
  CreateNoteDto,
  NoteDetailDto,
  NoteListResponseDto,
  PinNoteDto,
  RestoredNoteDto,
  UpdateNoteDto,
} from "@/lib/api/types/notes";
import { entityHref } from "@/lib/entity-routes";
import {
  errorMessageKey,
  type ActionResult,
  type EntityRef,
  type Paginated,
} from "@/lib/validators/common";
import {
  noteFilterSchema,
  updateNoteInputSchema,
  type ArchiveNoteInput,
  type AttachFileInput,
  type CreateNoteFormValues,
  type LinkNoteInput,
  type NoteDetailDTO,
  type NoteFilter,
  type NoteFilterInput,
  type NoteIdInput,
  type NoteListRowDTO,
  type PinNoteInput,
  type UnlinkNoteInput,
} from "@/lib/validators/notes";
import type { ArchivedRecordDTO } from "@/lib/validators/trash";
import type { z } from "@/lib/validators/zod";
import { toNoteListQuery } from "./api-query";
import { NOTE_EXPORT_COLUMNS } from "./columns";
import { toNoteDetail, toNotePage } from "./mappers";

// Thin API proxies (C10): token → one BE call → error mapping → revalidate. The BE decides every grant (a Member
// archives only their own notes, a Viewer writes none) and every rule (last link, READY attachments, the C4
// allowlist); the FE never checks `can()` here.

/** Pages that show a note: the table, the note and every record it hangs from (their *Notas* tab). */
function notePaths(noteId: string | null, refs: readonly Pick<EntityRef, "type" | "id">[]) {
  const paths = new Set<string>(["/notes"]);
  if (noteId) paths.add(`/notes/${noteId}`);
  for (const ref of refs) {
    const href = entityHref(ref);
    if (href) paths.add(href);
  }
  return [...paths];
}

/** Maps the successful result of an action; a failure passes through untouched. */
async function mapResult<TIn, TOut>(
  result: Promise<ActionResult<TIn>>,
  map: (data: TIn) => TOut,
): Promise<ActionResult<TOut>> {
  const resolved = await result;
  return resolved.ok ? { ok: true, data: map(resolved.data) } : resolved;
}

const createNote = apiAction<CreateNoteFormValues, NoteDetailDto>({
  call: (input, api) => {
    const body: CreateNoteDto = {
      content: input.content,
      links: input.links,
      pinned: input.pinned ?? false,
      tagIds: input.tagIds ?? [],
      attachmentFileIds: input.attachmentFileIds ?? [],
      ...(input.title ? { title: input.title } : {}),
    };
    return api.POST("/api/v1/notes", { body });
  },
  revalidate: (_input, note) => notePaths(note.id, note.links),
});

/** Creates a note linked to at least one record; pasted images arrive in `attachmentFileIds` (C4). */
export async function createNoteAction(
  input: CreateNoteFormValues,
): Promise<ActionResult<NoteDetailDTO>> {
  return mapResult(createNote(input), toNoteDetail);
}

type UpdateNoteFormValues = z.input<typeof updateNoteInputSchema>;

const updateNote = apiAction<UpdateNoteFormValues, NoteDetailDto>({
  call: ({ id, ...rest }, api) => {
    const body: UpdateNoteDto = {
      content: rest.content,
      tagIds: rest.tagIds ?? [],
      title: rest.title ?? null,
    };
    return api.PATCH("/api/v1/notes/{id}", { params: { path: { id } }, body });
  },
  revalidate: (_input, note) => notePaths(note.id, note.links),
});

export async function updateNoteAction(
  input: UpdateNoteFormValues,
): Promise<ActionResult<NoteDetailDTO>> {
  return mapResult(updateNote(input), toNoteDetail);
}

const pinNote = apiAction<PinNoteInput, NoteDetailDto>({
  call: ({ id, pinned }, api) => {
    const body: PinNoteDto = { pinned };
    return api.POST("/api/v1/notes/{id}/pin", { params: { path: { id } }, body });
  },
  revalidate: (_input, note) => notePaths(note.id, note.links),
});

export async function pinNoteAction(input: PinNoteInput): Promise<ActionResult<NoteDetailDTO>> {
  return mapResult(pinNote(input), toNoteDetail);
}

const linkNote = apiAction<LinkNoteInput, NoteDetailDto>({
  call: ({ noteId, target }, api) =>
    api.POST("/api/v1/notes/{id}/links", { params: { path: { id: noteId } }, body: target }),
  revalidate: (_input, note) => notePaths(note.id, note.links),
});

/** Hangs the note from one more record. A target unknown to the BE answers `NOT_FOUND`. */
export async function linkNoteAction(input: LinkNoteInput): Promise<ActionResult<NoteDetailDTO>> {
  return mapResult(linkNote(input), toNoteDetail);
}

const unlinkNote = apiAction<UnlinkNoteInput, NoteDetailDto>({
  call: ({ noteId, target }, api) =>
    api.POST("/api/v1/notes/{id}/unlink", { params: { path: { id: noteId } }, body: target }),
  revalidate: ({ target }, note) =>
    notePaths(note.id, [...note.links, { type: target.entityType, id: target.entityId }]),
});

/** Removes a link; the BE keeps at least one (`INTEGRITY_LOCK`). */
export async function unlinkNoteAction(
  input: UnlinkNoteInput,
): Promise<ActionResult<NoteDetailDTO>> {
  return mapResult(unlinkNote(input), toNoteDetail);
}

const attachFile = apiAction<AttachFileInput, NoteDetailDto>({
  call: ({ noteId, fileId }, api) =>
    api.POST("/api/v1/notes/{id}/attachments", {
      params: { path: { id: noteId } },
      body: { fileId },
    }),
  revalidate: (_input, note) => notePaths(note.id, note.links),
});

/** Attaches an uploaded file (after the upload confirmed it); a `PENDING` file answers `NOT_FOUND`. */
export async function attachFileAction(
  input: AttachFileInput,
): Promise<ActionResult<NoteDetailDTO>> {
  return mapResult(attachFile(input), toNoteDetail);
}

/** Soft delete. The BE lets Owner and Admin archive any note and a Member only their own (`FORBIDDEN`). */
export const archiveNoteAction = apiAction<ArchiveNoteInput, ArchivedNoteDto>({
  call: ({ id }, api) => api.POST("/api/v1/notes/{id}/archive", { params: { path: { id } } }),
  revalidate: ["/notes"],
}) satisfies (input: ArchiveNoteInput) => Promise<ActionResult<ArchivedRecordDTO>>;

/** Restores an archived note (trash roles; the BE decides). Resolves to a reference to the note. */
export const restoreNoteAction = apiAction<NoteIdInput, RestoredNoteDto>({
  call: ({ id }, api) => api.POST("/api/v1/notes/{id}/restore", { params: { path: { id } } }),
  revalidate: (_input, note) => notePaths(note.id, []),
});

const getNote = apiAction<NoteIdInput, NoteDetailDto>({
  call: ({ id }, api) => api.GET("/api/v1/notes/{id}", { params: { path: { id } } }),
});

/** Read action behind the card's expanded preview and the composer's edit mode. */
export async function getNoteAction(input: NoteIdInput): Promise<ActionResult<NoteDetailDTO>> {
  return mapResult(getNote(input), toNoteDetail);
}

const listNotes = apiAction<NoteFilter, NoteListResponseDto>({
  call: (filter, api) => api.GET("/api/v1/notes", { params: { query: toNoteListQuery(filter) } }),
});

/** Read action behind the feed's "Cargar más" and the table; the filter is checked for UX only. */
export async function listNotesAction(
  input: NoteFilterInput,
): Promise<ActionResult<Paginated<NoteListRowDTO>>> {
  const parsed = noteFilterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return mapResult(listNotes(parsed.data), toNotePage);
}

export const exportNotesCsvAction = defineCsvExportAction<NoteListRowDTO, NoteFilter>({
  entity: "NOTE",
  source: {
    entity: "NOTE",
    facets: [
      { id: "authorId", kind: "async" },
      { id: "tagId", kind: "async" },
      { id: "linkedEntityType", kind: "options" },
      { id: "createdAt", kind: "dateRange", fromKey: "createdFrom", toKey: "createdTo" },
    ],
    filterSchema: noteFilterSchema,
    columns: NOTE_EXPORT_COLUMNS,
  },
  namespace: "notes",
});
