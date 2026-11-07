import type { NoteListQuery, NoteListSort } from "@/lib/api/types/notes";
import type { NoteFilter } from "@/lib/validators/notes";

/**
 * Sort tokens of `GET /api/v1/notes`. The record is exhaustive over the generated union, so a contract change
 * that adds or removes a token fails `tsc` here (C8).
 */
const NOTE_SORTS: Record<NoteListSort, true> = {
  "createdAt:asc": true,
  "createdAt:desc": true,
  "updatedAt:asc": true,
  "updatedAt:desc": true,
  "title:asc": true,
  "title:desc": true,
  "pinned:asc": true,
  "pinned:desc": true,
};

function isNoteListSort(value: string): value is NoteListSort {
  return Object.hasOwn(NOTE_SORTS, value);
}

/** The table's or feed's parsed filter → the query parameters of `GET /api/v1/notes` (`api-contract.md` §3). */
export function toNoteListQuery(filter: NoteFilter): NoteListQuery {
  const query: NoteListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isNoteListSort(filter.sort)) query.sort = filter.sort;
  if (filter.entityType !== undefined) query.entityType = filter.entityType;
  if (filter.entityId !== undefined) query.entityId = filter.entityId;
  if (filter.authorId !== undefined) query.authorId = filter.authorId;
  if (filter.tagId !== undefined) query.tagId = filter.tagId;
  if (filter.linkedEntityType !== undefined) query.linkedEntityType = filter.linkedEntityType;
  if (filter.pinned !== undefined) query.pinned = filter.pinned ? "true" : "false";
  if (filter.createdFrom !== undefined) query.createdFrom = filter.createdFrom;
  if (filter.createdTo !== undefined) query.createdTo = filter.createdTo;
  return query;
}
