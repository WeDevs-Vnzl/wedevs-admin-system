// MOCK — tag catalog reads of Hito 1 (PRD §7.5, §12 `tags`). `fn(ctx, input)`, framework-free (C11).
// Tag rows hold ids only; the records carry `tagIds` (PD-3) and the usage count is derived here from the
// non-archived records. Replaced by `src/server/services/tags.service.ts` in Hito 2 (C9).
import type { Paginated } from "@/lib/validators/common";
import { can, type PermissionResource } from "@/server/auth/permissions";
import type {
  AssignTagsInput,
  CreateTagInput,
  TagChipDTO,
  TagDetailDTO,
  TagFilter,
  TagIdInput,
  TagListRowDTO,
  TaggableEntityType,
  UnassignTagInput,
  UpdateTagInput,
} from "@/lib/validators/tags";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { resolveEntityRef } from "../entity-refs";
import type { TagRow } from "../fixtures/catalogs";
import { nextMockId } from "../ids";
import type { MockStore } from "../store";
import { logActivity, mockTx } from "./activity";
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

// ───────────────────────────── Writes (PRD §12 `tags`) ─────────────────────────────

/** Resource of the `can()` matrix that governs tagging each taggable entity type (PRD §7.5). */
const TAG_RESOURCE: Record<TaggableEntityType, PermissionResource> = {
  CLIENT: "client",
  CONTACT: "contact",
  PROJECT: "project",
  DOCUMENT: "document",
  NOTE: "note",
  INVOICE: "invoice",
  PAYMENT: "payment",
  EXPENSE: "expense",
};

/** Entity types whose rows exist in the mock store today; finance types arrive with H1-B3. */
const TAGGABLE_ROWS: Partial<Record<TaggableEntityType, (db: MockStore) => Taggable[]>> = {
  CLIENT: (db) => db.clients,
  CONTACT: (db) => db.contacts,
  PROJECT: (db) => db.projects,
  DOCUMENT: (db) => db.documents,
  NOTE: (db) => db.notes,
};

interface TaggedRecord extends Taggable {
  tagIds: string[];
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** `CONFLICT` on the tag already using the name (case-insensitive), ignoring `exceptId` (a rename of itself). */
function assertUniqueName(db: MockStore, name: string, exceptId?: string): void {
  const taken = db.tags.find((tag) => tag.id !== exceptId && sameName(tag.name, name));
  if (taken) {
    throw new ServiceError("CONFLICT", {
      fieldErrors: { name: ["tags.errors.nameTaken"] },
      entity: { type: "TAG", id: taken.id, label: taken.name },
    });
  }
}

function findTag(db: MockStore, id: string): TagRow {
  const tag = db.tags.find((row) => row.id === id);
  if (!tag) throw new ServiceError("NOT_FOUND");
  return tag;
}

/** `createTag`: the name is unique, case-insensitively. Permission is the adapter's (several resources may create). */
export async function createTag(
  ctx: MockServiceContext,
  input: CreateTagInput,
): Promise<TagDetailDTO> {
  assertUniqueName(ctx.db, input.name);
  const row: TagRow = {
    id: nextMockId(ctx.db.idCounters, "tag", (id) => ctx.db.tags.some((tag) => tag.id === id)),
    name: input.name.trim(),
    color: input.color,
    createdAt: ctx.now.toISOString(),
  };
  ctx.db.tags.push(row);
  return tagListRow(ctx.db, row);
}

/** `updateTag`: rename and/or recolour; a rename keeps the name unique. */
export async function updateTag(
  ctx: MockServiceContext,
  input: UpdateTagInput,
): Promise<TagDetailDTO> {
  const tag = findTag(ctx.db, input.id);
  if (input.name !== undefined) assertUniqueName(ctx.db, input.name, tag.id);
  if (input.name !== undefined) tag.name = input.name.trim();
  if (input.color !== undefined) tag.color = input.color;
  return tagListRow(ctx.db, tag);
}

/** The record of a taggable entity: `FORBIDDEN` without `update` on its resource, `NOT_FOUND` when absent or archived. */
function taggedRecord(
  ctx: MockServiceContext,
  entityType: TaggableEntityType,
  entityId: string,
): TaggedRecord {
  if (!can(ctx.user, "update", TAG_RESOURCE[entityType])) throw new ServiceError("FORBIDDEN");
  const rows = TAGGABLE_ROWS[entityType];
  const record = rows?.(ctx.db).find((row) => row.id === entityId);
  if (!record || record.archivedAt) throw new ServiceError("NOT_FOUND");
  return record as TaggedRecord;
}

function chipsOf(db: MockStore, tagIds: readonly string[]): TagChipDTO[] {
  return db.tags
    .filter((tag) => tagIds.includes(tag.id))
    .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));
}

/** One `LINK` / `UNLINK` entry on the tagged entity, carrying the tag in its metadata (PRD §8.14). */
async function logTagLink(
  ctx: MockServiceContext,
  action: "LINK" | "UNLINK",
  entityType: TaggableEntityType,
  entityId: string,
  tag: Pick<TagRow, "id" | "name">,
): Promise<void> {
  const entity = resolveEntityRef(ctx.db, entityType, entityId);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action,
    entityType,
    entityId,
    entityLabel: entity?.label ?? entityId,
    metadata: { tagId: tag.id, tagName: tag.name },
  });
}

/**
 * `assignTags`: adds tags to one entity (already assigned ones are ignored). Returns the entity's chips.
 * One `LINK` entry per tag actually added; no entry when every tag was already assigned.
 */
export async function assignTags(
  ctx: MockServiceContext,
  input: AssignTagsInput,
): Promise<TagChipDTO[]> {
  const record = taggedRecord(ctx, input.entityType, input.entityId);
  for (const tagId of input.tagIds) findTag(ctx.db, tagId);
  const current = record.tagIds ?? [];
  const added = [...new Set(input.tagIds)].filter((tagId) => !current.includes(tagId));
  record.tagIds = [...current, ...added];
  for (const tagId of added) {
    await logTagLink(ctx, "LINK", input.entityType, input.entityId, findTag(ctx.db, tagId));
  }
  return chipsOf(ctx.db, record.tagIds);
}

/**
 * `unassignTag`: removes one tag from one entity. Returns the entity's remaining chips. One `UNLINK`
 * entry when the tag was assigned; no entry otherwise.
 */
export async function unassignTag(
  ctx: MockServiceContext,
  input: UnassignTagInput,
): Promise<TagChipDTO[]> {
  const record = taggedRecord(ctx, input.entityType, input.entityId);
  const current = record.tagIds ?? [];
  const removed = current.includes(input.tagId);
  record.tagIds = current.filter((id) => id !== input.tagId);
  if (removed) {
    const tag = ctx.db.tags.find((row) => row.id === input.tagId) ?? {
      id: input.tagId,
      name: input.tagId,
    };
    await logTagLink(ctx, "UNLINK", input.entityType, input.entityId, tag);
  }
  return chipsOf(ctx.db, record.tagIds);
}
