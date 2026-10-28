// MOCK — document categories and types of Hito 1 (PRD §8.9.1, §12 `settings`, HU-21). `fn(ctx, input)`,
// framework-free (C11). Documents point at a type by `typeId` and the category is derived from the type; the
// document count is derived here from the document rows. Replaced by
// `src/server/services/document-types.service.ts` in Hito 2 (C9).
import { diffFields } from "@/lib/activity-diff";
import type { ActivityChanges } from "@/lib/validators/activity";
import type { Paginated } from "@/lib/validators/common";
import type {
  CreateDocumentCategoryInput,
  CreateDocumentTypeInput,
  DeleteDocumentCategoryInput,
  DeleteDocumentTypeInput,
  DocumentCategoryDetailDTO,
  DocumentTypeDetailDTO,
  DocumentTypeFilter,
  DocumentTypeIdInput,
  DocumentTypeListRowDTO,
  ReorderDocumentCategoriesInput,
  SetDocumentTypeActiveInput,
  UpdateDocumentCategoryInput,
  UpdateDocumentTypeInput,
} from "@/lib/validators/document-types";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import type { DocumentCategoryRow, DocumentTypeRow } from "../fixtures/catalogs";
import { nextMockId } from "../ids";
import type { MockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

const MESSAGES = {
  categoryNameTaken: "catalogs.documentTypes.errors.categoryNameTaken",
  categoryHasTypes: "catalogs.documentTypes.errors.categoryHasTypes",
  reorderMismatch: "catalogs.documentTypes.errors.reorderMismatch",
  unknownCategory: "catalogs.documentTypes.errors.unknownCategory",
  typeNameTaken: "catalogs.documentTypes.errors.typeNameTaken",
  typeInUse: "catalogs.documentTypes.errors.typeInUse",
} as const;

// ───────────────────────────── Reads ─────────────────────────────

type DocumentTypeBase = Omit<DocumentTypeDetailDTO, "category">;

function documentTypeBase(db: MockStore, row: DocumentTypeRow): DocumentTypeBase {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    defaultFormat: row.defaultFormat,
    requiresSignature: row.requiresSignature,
    hasExpiration: row.hasExpiration,
    active: row.active,
    documentCount: db.documents.filter((doc) => !doc.archivedAt && doc.typeId === row.id).length,
  };
}

function documentTypeDetail(db: MockStore, row: DocumentTypeRow): DocumentTypeDetailDTO | null {
  const category = db.documentCategories.find((item) => item.id === row.categoryId);
  if (!category) return null;
  const { id, name, nameEn, color } = category;
  return { ...documentTypeBase(db, row), category: { id, name, nameEn, color } };
}

function categoryDetail(db: MockStore, row: DocumentCategoryRow): DocumentCategoryDetailDTO {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    color: row.color,
    order: row.order,
    types: db.documentTypes
      .filter((type) => type.categoryId === row.id)
      .map((type) => documentTypeBase(db, type)),
  };
}

const documentTypeSpec: ListSpec<DocumentTypeListRowDTO> = {
  searchText: (row) => [row.name, row.nameEn, row.category.name],
  sorters: {
    name: (row) => row.name,
    category: (row) => row.category.name,
    documentCount: (row) => row.documentCount,
    active: (row) => row.active,
  },
  defaultSort: "name:asc",
};

export async function listDocumentTypes(
  ctx: MockServiceContext,
  input: DocumentTypeFilter,
): Promise<Paginated<DocumentTypeListRowDTO>> {
  const rows = ctx.db.documentTypes
    .map((type) => documentTypeDetail(ctx.db, type))
    .filter((row): row is DocumentTypeListRowDTO => row !== null)
    .filter((row) => !input.categoryId || input.categoryId.includes(row.category.id))
    .filter((row) => input.active === undefined || row.active === input.active)
    .filter(
      (row) =>
        input.requiresSignature === undefined || row.requiresSignature === input.requiresSignature,
    )
    .filter(
      (row) => input.hasExpiration === undefined || row.hasExpiration === input.hasExpiration,
    );
  return listRows(rows, input, documentTypeSpec);
}

/** Categories in their configured order, each with its types (Settings tree, grouped type picker). */
export async function listDocumentCategories(
  ctx: MockServiceContext,
): Promise<DocumentCategoryDetailDTO[]> {
  return [...ctx.db.documentCategories]
    .sort((a, b) => a.order - b.order)
    .map((row) => categoryDetail(ctx.db, row));
}

/** One type with its category and document count. `NOT_FOUND` when the id does not exist. */
export async function getDocumentType(
  ctx: MockServiceContext,
  input: DocumentTypeIdInput,
): Promise<DocumentTypeDetailDTO> {
  const detail = documentTypeDetail(ctx.db, findType(ctx, input.id));
  if (!detail) throw new ServiceError("NOT_FOUND");
  return detail;
}

// ───────────────────────────── Writes (Owner and Admin, `settings`) ─────────────────────────────

/** One `SETTINGS_CHANGE` activity entry, the shape every catalog write logs. */
async function logSettingsChange(
  ctx: MockServiceContext,
  entityId: string,
  entityLabel: string,
  changes: ActivityChanges | undefined,
): Promise<void> {
  if (!changes) return;
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "SETTINGS_CHANGE",
    entityType: "SETTING",
    entityId,
    entityLabel,
    changes,
  });
}

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function findCategory(ctx: MockServiceContext, id: string): DocumentCategoryRow {
  const row = ctx.db.documentCategories.find((category) => category.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

function findType(ctx: MockServiceContext, id: string): DocumentTypeRow {
  const row = ctx.db.documentTypes.find((type) => type.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

/** Category names are unique (case-insensitive); `exceptId` is the category being edited. */
function assertUniqueCategory(ctx: MockServiceContext, name: string, exceptId?: string): void {
  const taken = ctx.db.documentCategories.some(
    (category) => category.id !== exceptId && sameText(category.name, name),
  );
  if (taken) {
    throw new ServiceError("CONFLICT", { fieldErrors: { name: [MESSAGES.categoryNameTaken] } });
  }
}

/** Renumbers `order` from 0 following the given sequence. */
function renumber(rows: DocumentCategoryRow[]): void {
  rows.forEach((row, index) => {
    row.order = index;
  });
}

function sortedCategories(db: MockStore): DocumentCategoryRow[] {
  return [...db.documentCategories].sort((a, b) => a.order - b.order);
}

/** Appends a category after the last one. */
export async function createDocumentCategory(
  ctx: MockServiceContext,
  input: CreateDocumentCategoryInput,
): Promise<DocumentCategoryDetailDTO> {
  assertUniqueCategory(ctx, input.name);
  const row: DocumentCategoryRow = {
    id: nextMockId(ctx.db.idCounters, "dcat", (id) =>
      ctx.db.documentCategories.some((category) => category.id === id),
    ),
    name: input.name,
    nameEn: input.nameEn ?? null,
    color: input.color ?? null,
    order: ctx.db.documentCategories.reduce(
      (max, category) => Math.max(max, category.order + 1),
      0,
    ),
  };
  ctx.db.documentCategories.push(row);
  await logSettingsChange(ctx, row.id, row.name, { documentCategory: [null, row.name] });
  return categoryDetail(ctx.db, row);
}

/** Edits name, English name and colour; the order changes only through `reorderDocumentCategories`. */
export async function updateDocumentCategory(
  ctx: MockServiceContext,
  input: UpdateDocumentCategoryInput,
): Promise<DocumentCategoryDetailDTO> {
  const row = findCategory(ctx, input.id);
  assertUniqueCategory(ctx, input.name, row.id);
  const before = { ...row };
  Object.assign(row, {
    name: input.name,
    nameEn: input.nameEn ?? null,
    color: input.color ?? null,
  });
  const changes = diffFields(before, row, { fields: ["name", "nameEn", "color"] });
  await logSettingsChange(ctx, row.id, row.name, changes);
  return categoryDetail(ctx.db, row);
}

/** Takes every category id in the new order; any other set of ids is a `VALIDATION` error. */
export async function reorderDocumentCategories(
  ctx: MockServiceContext,
  input: ReorderDocumentCategoriesInput,
): Promise<DocumentCategoryDetailDTO[]> {
  const rows = input.orderedIds.map((id) =>
    ctx.db.documentCategories.find((category) => category.id === id),
  );
  const complete =
    rows.length === ctx.db.documentCategories.length &&
    rows.every((row): row is DocumentCategoryRow => row !== undefined);
  if (!complete) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { orderedIds: [MESSAGES.reorderMismatch] },
    });
  }
  const before = sortedCategories(ctx.db).map((row) => row.name);
  renumber(rows as DocumentCategoryRow[]);
  const after = sortedCategories(ctx.db).map((row) => row.name);
  if (before.join("\n") !== after.join("\n")) {
    await logSettingsChange(ctx, "document-categories", "document-categories", {
      documentCategoryOrder: [before.join(", "), after.join(", ")],
    });
  }
  return listDocumentCategories(ctx);
}

/**
 * Removes an empty category for good (catalog rows are not soft-deleted, data-rules.md §6). A category with
 * types is locked (`INTEGRITY_LOCK`): its types are moved or deleted first.
 */
export async function deleteDocumentCategory(
  ctx: MockServiceContext,
  input: DeleteDocumentCategoryInput,
): Promise<DeleteDocumentCategoryInput> {
  const row = findCategory(ctx, input.id);
  if (ctx.db.documentTypes.some((type) => type.categoryId === row.id)) {
    throw new ServiceError("INTEGRITY_LOCK", { message: MESSAGES.categoryHasTypes });
  }
  ctx.db.documentCategories.splice(ctx.db.documentCategories.indexOf(row), 1);
  renumber(sortedCategories(ctx.db));
  await logSettingsChange(ctx, row.id, row.name, { documentCategory: [row.name, null] });
  return { id: row.id };
}

/** The category must exist, and type names are unique inside it (case-insensitive). */
function assertTypePlacement(
  ctx: MockServiceContext,
  input: { categoryId: string; name: string },
  exceptId?: string,
): void {
  if (!ctx.db.documentCategories.some((category) => category.id === input.categoryId)) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { categoryId: [MESSAGES.unknownCategory] },
    });
  }
  const taken = ctx.db.documentTypes.some(
    (type) =>
      type.id !== exceptId &&
      type.categoryId === input.categoryId &&
      sameText(type.name, input.name),
  );
  if (taken) {
    throw new ServiceError("CONFLICT", { fieldErrors: { name: [MESSAGES.typeNameTaken] } });
  }
}

function typeDetailOrThrow(ctx: MockServiceContext, row: DocumentTypeRow): DocumentTypeDetailDTO {
  const detail = documentTypeDetail(ctx.db, row);
  if (!detail) throw new ServiceError("NOT_FOUND");
  return detail;
}

export async function createDocumentType(
  ctx: MockServiceContext,
  input: CreateDocumentTypeInput,
): Promise<DocumentTypeDetailDTO> {
  assertTypePlacement(ctx, input);
  const row: DocumentTypeRow = {
    id: nextMockId(ctx.db.idCounters, "dtyp", (id) =>
      ctx.db.documentTypes.some((type) => type.id === id),
    ),
    categoryId: input.categoryId,
    name: input.name,
    nameEn: input.nameEn ?? null,
    requiresSignature: input.requiresSignature,
    hasExpiration: input.hasExpiration,
    defaultFormat: input.defaultFormat,
    active: input.active,
  };
  ctx.db.documentTypes.push(row);
  await logSettingsChange(ctx, row.id, row.name, { documentType: [null, row.name] });
  return typeDetailOrThrow(ctx, row);
}

/** Edits every field, incl. the category and the capabilities (`requiresSignature`, `hasExpiration`). */
export async function updateDocumentType(
  ctx: MockServiceContext,
  input: UpdateDocumentTypeInput,
): Promise<DocumentTypeDetailDTO> {
  const row = findType(ctx, input.id);
  assertTypePlacement(ctx, input, row.id);
  const before = { ...row };
  Object.assign(row, {
    categoryId: input.categoryId,
    name: input.name,
    nameEn: input.nameEn ?? null,
    requiresSignature: input.requiresSignature,
    hasExpiration: input.hasExpiration,
    defaultFormat: input.defaultFormat,
    active: input.active,
  });
  const changes = diffFields(before, row, {
    fields: [
      "categoryId",
      "name",
      "nameEn",
      "requiresSignature",
      "hasExpiration",
      "defaultFormat",
      "active",
    ],
  });
  await logSettingsChange(ctx, row.id, row.name, changes);
  return typeDetailOrThrow(ctx, row);
}

/** Activates or deactivates a type: the way to retire one that documents use (HU-21 CA2). */
export async function setDocumentTypeActive(
  ctx: MockServiceContext,
  input: SetDocumentTypeActiveInput,
): Promise<DocumentTypeDetailDTO> {
  const row = findType(ctx, input.id);
  if (row.active !== input.active) {
    row.active = input.active;
    await logSettingsChange(ctx, row.id, row.name, { active: [!input.active, input.active] });
  }
  return typeDetailOrThrow(ctx, row);
}

/**
 * Removes a type no document points at. A type used by any document, archived ones included (they keep
 * their `typeId` and may be restored), is locked (`INTEGRITY_LOCK`, HU-21 CA2): the user deactivates it.
 */
export async function deleteDocumentType(
  ctx: MockServiceContext,
  input: DeleteDocumentTypeInput,
): Promise<DeleteDocumentTypeInput> {
  const row = findType(ctx, input.id);
  if (ctx.db.documents.some((doc) => doc.typeId === row.id)) {
    throw new ServiceError("INTEGRITY_LOCK", { message: MESSAGES.typeInUse });
  }
  ctx.db.documentTypes.splice(ctx.db.documentTypes.indexOf(row), 1);
  await logSettingsChange(ctx, row.id, row.name, { documentType: [row.name, null] });
  return { id: row.id };
}
