import "server-only";
import { getServerApi } from "@/lib/api/server";
import {
  noteFilterSchema,
  noteIdInputSchema,
  type NoteFilterInput,
  type NoteIdInput,
} from "@/lib/validators/notes";
import { getServiceContext } from "@/server/context";
// MOCK — until cleanup: `app/(app)/notes/[id]/page.tsx` catches `ServiceError` for the not-found page.
import { ServiceError } from "@/lib/service-error";
import { toNoteListQuery } from "./api-query";
import { toNoteDetail, toNotePage } from "./mappers";

/** Notes of the table or of one record's feed (`entityType` + `entityId`), through `GET /api/v1/notes`. */
export async function listNotes(filter: NoteFilterInput = {}) {
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/notes", {
    params: { query: toNoteListQuery(noteFilterSchema.parse(filter)) },
  });
  if (!data) throw new Error(`GET /api/v1/notes failed with ${response.status}`);
  return toNotePage(data);
}

/** One note through `GET /api/v1/notes/{id}`; a BE `404` throws `ServiceError("NOT_FOUND")` for the page's `notFound()`. */
export async function getNote(input: NoteIdInput) {
  const { id } = noteIdInputSchema.parse(input);
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/notes/{id}", { params: { path: { id } } });
  if (data) return toNoteDetail(data);
  // MOCK — until cleanup: CLEAN replaces `@/lib/service-error` and its consumers.
  if (response.status === 404) throw new ServiceError("NOT_FOUND");
  throw new Error(`GET /api/v1/notes/${id} failed with ${response.status}`);
}

/** The signed-in user's id and role, for the `can()` checks that decide which note actions are shown (cosmetic, C13). */
export async function getNotesViewer() {
  const { user } = await getServiceContext();
  return { id: user.id, role: user.role };
}
