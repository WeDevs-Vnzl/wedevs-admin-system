// MOCK — tag catalog reads of Hito 1 (PRD §7.5, §12 `tags`). `fn(ctx, input)`, framework-free (C11).
// Tag rows hold ids only; the records carry `tagIds` (PD-3) and the usage count is derived here from the
// non-archived records. Replaced by `src/server/services/tags.service.ts` in Hito 2 (C9).
import type { Paginated } from "@/lib/validators/common";
import type { TagChipDTO, TagFilter, TagIdInput, TagListRowDTO } from "@/lib/validators/tags";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import type { TagRow } from "../fixtures/catalogs";
import type { MockStore } from "../store";
import { listRows, type ListSpec } from "./list";

interface Taggable {
  id: string;
  archivedAt?: string | null;
  tagIds?: readonly string[];
  /** Finance records (H1-B3) still embed their chips. */
  tags?: readonly Pick<TagChipDTO, "id">[];
}

const TAGGED_ENTITY_COLLECTIONS = [
  ["CLIENT", (db: MockStore): readonly Taggable[] => db.clients],
  ["CONTACT", (db: MockStore): readonly Taggable[] => db.contacts],
  ["PROJECT", (db: MockStore): readonly Taggable[] => db.projects],
  ["DOCUMENT", (db: MockStore): readonly Taggable[] => db.documents],
  ["NOTE", (db: MockStore): readonly Taggable[] => db.notes],
  ["INVOICE", (db: MockStore): readonly Taggable[] => db.invoices],
  ["PAYMENT", (db: MockStore): readonly Taggable[] => db.payments],
  ["EXPENSE", (db: MockStore): readonly Taggable[] => db.expenses],
] as const;

function carries(record: Taggable, tagId: string): boolean {
  return (
    (record.tagIds?.includes(tagId) ?? false) ||
    (record.tags?.some((tag) => tag.id === tagId) ?? false)
  );
}

/** Non-archived records carrying the tag, optionally limited to some entity types. */
export function tagUsage(db: MockStore, tagId: string, entityTypes?: readonly string[]): number {
  let count = 0;
  for (const [entityType, rows] of TAGGED_ENTITY_COLLECTIONS) {
    if (entityTypes && !entityTypes.includes(entityType)) continue;
    count += rows(db).filter((record) => !record.archivedAt && carries(record, tagId)).length;
  }
  return count;
}

function tagListRow(db: MockStore, tag: TagRow, entityTypes?: readonly string[]): TagListRowDTO {
  return { ...tag, usageCount: tagUsage(db, tag.id, entityTypes) };
}

const tagSpec: ListSpec<TagListRowDTO> = {
  searchText: (row) => [row.name],
  sorters: {
    name: (row) => row.name,
    usageCount: (row) => row.usageCount,
    createdAt: (row) => row.createdAt,
  },
  defaultSort: "name:asc",
};

export async function listTags(
  ctx: MockServiceContext,
  input: TagFilter,
): Promise<Paginated<TagListRowDTO>> {
  const rows = ctx.db.tags
    .map((tag) => tagListRow(ctx.db, tag, input.entityType))
    .filter((row) => !input.entityType || row.usageCount > 0);
  return listRows(rows, input, tagSpec);
}

/** One tag with its usage count (all entity types). `NOT_FOUND` when the id does not exist. */
export async function getTag(ctx: MockServiceContext, input: TagIdInput): Promise<TagListRowDTO> {
  const tag = ctx.db.tags.find((row) => row.id === input.id);
  if (!tag) throw new ServiceError("NOT_FOUND");
  return tagListRow(ctx.db, tag);
}
