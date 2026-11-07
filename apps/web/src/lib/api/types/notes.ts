import type { components, operations } from "../schema";

// Generated note DTOs and query types re-exported for the notes feature (C8): code outside `src/lib/api/**`
// may not import the schema.

/** Query of `GET /api/v1/notes`. */
export type NoteListQuery = NonNullable<operations["listNotes"]["parameters"]["query"]>;
/** The `sort` tokens `GET /api/v1/notes` accepts. */
export type NoteListSort = NonNullable<NoteListQuery["sort"]>;

/** `GET /api/v1/notes`: one page of notes. */
export type NoteListResponseDto = components["schemas"]["NoteListResponseDto"];
/** One note (the detail and every write response). */
export type NoteDetailDto = components["schemas"]["NoteDetailDto"];
/** `POST /api/v1/notes/{id}/archive` response. */
export type ArchivedNoteDto = components["schemas"]["ArchivedNoteDto"];
export type CreateNoteDto = components["schemas"]["CreateNoteDto"];
export type UpdateNoteDto = components["schemas"]["UpdateNoteDto"];
export type PinNoteDto = components["schemas"]["PinNoteDto"];
export type NoteLinkTargetDto = components["schemas"]["NoteLinkTargetDto"];
export type AttachNoteFileDto = components["schemas"]["AttachNoteFileDto"];
/** `POST /api/v1/notes/{id}/restore` response: a reference to the restored note. */
export type RestoredNoteDto = components["schemas"]["EntityRefDto"];
