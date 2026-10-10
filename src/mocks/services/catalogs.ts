// MOCK — catalog services of Hito 1 (PRD §12 `settings`, §9.2). `fn(ctx, input)`, framework-free (C11).
// Replaced by `src/server/services/catalogs.service.ts` (and its siblings) in Hito 2 (C9).
import { selectRate, type SelectedRate } from "@/lib/rates";
import type { Paginated } from "@/lib/validators/common";
import type {
  CurrencyDTO,
  ExpenseCategoryTreeNode,
  GetRateForInput,
  PaymentMethodDTO,
} from "@/lib/validators/catalogs";
import type {
  DocumentCategoryDetailDTO,
  DocumentTypeDetailDTO,
  DocumentTypeFilter,
  DocumentTypeListRowDTO,
} from "@/lib/validators/document-types";
import type { FiscalSettings } from "@/lib/validators/settings";
import type { TagChipDTO, TagFilter, TagListRowDTO } from "@/lib/validators/tags";
import type { TechnologyFilter, TechnologyListRowDTO } from "@/lib/validators/technologies";
import type { MockServiceContext } from "../ctx";
import type { DocumentTypeRow } from "../fixtures/catalogs";
import type { MockStore } from "../store";
import { listRows, type ListSpec } from "./list";

/**
 * `getRateFor` (PRD §9.2, DT-67): the rate to prefill for `currency` on `date`, with every usable rate of
 * the effective date as `options`. `null` when there is none on or before the date; the user types it.
 */
export async function getRateFor(
  ctx: MockServiceContext,
  input: GetRateForInput,
): Promise<SelectedRate | null> {
  return selectRate(ctx.db.exchangeRates, input.date, input.currency);
}

export async function listCurrencies(ctx: MockServiceContext): Promise<CurrencyDTO[]> {
  return structuredClone(ctx.db.currencies);
}

export async function listPaymentMethods(ctx: MockServiceContext): Promise<PaymentMethodDTO[]> {
  return structuredClone(ctx.db.paymentMethods);
}

export async function getFiscalSettings(ctx: MockServiceContext): Promise<FiscalSettings> {
  return structuredClone(ctx.db.fiscal);
}

// ───────────────────────────── Technologies ─────────────────────────────

function technologyUsage(db: MockStore, technologyId: string): number {
  return db.projects.filter(
    (project) => !project.archivedAt && project.stack.some((tech) => tech.id === technologyId),
  ).length;
}

const technologySpec: ListSpec<TechnologyListRowDTO> = {
  searchText: (row) => [row.name, row.nameEn, row.slug],
  sorters: {
    name: (row) => row.name,
    category: (row) => row.category,
    usageCount: (row) => row.usageCount,
    active: (row) => row.active,
  },
  defaultSort: "name:asc",
};

export async function listTechnologies(
  ctx: MockServiceContext,
  input: TechnologyFilter,
): Promise<Paginated<TechnologyListRowDTO>> {
  const rows = ctx.db.technologies
    .filter((tech) => !input.category || input.category.includes(tech.category))
    .filter((tech) => input.active === undefined || tech.active === input.active)
    .map((tech): TechnologyListRowDTO => ({
      ...tech,
      usageCount: technologyUsage(ctx.db, tech.id),
    }));
  return listRows(rows, input, technologySpec);
}

// ───────────────────────────── Document categories and types ─────────────────────────────

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
    documentCount: db.documents.filter((doc) => !doc.archivedAt && doc.type.id === row.id).length,
  };
}

function documentTypeDetail(db: MockStore, row: DocumentTypeRow): DocumentTypeDetailDTO | null {
  const category = db.documentCategories.find((item) => item.id === row.categoryId);
  if (!category) return null;
  const { id, name, nameEn, color } = category;
  return { ...documentTypeBase(db, row), category: { id, name, nameEn, color } };
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
    .map(({ id, name, nameEn, color, order }) => ({
      id,
      name,
      nameEn,
      color,
      order,
      types: ctx.db.documentTypes
        .filter((type) => type.categoryId === id)
        .map((type) => documentTypeBase(ctx.db, type)),
    }));
}

// ───────────────────────────── Expense categories ─────────────────────────────

/** Two-level tree: every root with its children, in catalog order (PRD §8.8). */
export async function listExpenseCategories(
  ctx: MockServiceContext,
): Promise<ExpenseCategoryTreeNode[]> {
  return ctx.db.expenseCategories
    .filter((category) => category.parentId === null)
    .map((root) => ({
      ...root,
      children: ctx.db.expenseCategories.filter((child) => child.parentId === root.id),
    }))
    .map((node) => structuredClone(node));
}

// ───────────────────────────── Tags ─────────────────────────────

const TAGGED_ENTITY_COLLECTIONS = [
  ["CLIENT", (db: MockStore) => db.clients],
  ["CONTACT", (db: MockStore) => db.contacts],
  ["PROJECT", (db: MockStore) => db.projects],
  ["DOCUMENT", (db: MockStore) => db.documents],
  ["NOTE", (db: MockStore) => db.notes],
] as const;

/** Non-archived records carrying the tag, optionally limited to some entity types. */
function tagUsage(
  db: MockStore,
  tagId: string,
  entityTypes: readonly string[] | undefined,
): number {
  let count = 0;
  for (const [entityType, rows] of TAGGED_ENTITY_COLLECTIONS) {
    if (entityTypes && !entityTypes.includes(entityType)) continue;
    const records: readonly { tags: TagChipDTO[]; archivedAt?: string | null }[] = rows(db);
    count += records.filter(
      (record) => !record.archivedAt && record.tags.some((tag) => tag.id === tagId),
    ).length;
  }
  return count;
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
    .map((tag): TagListRowDTO => ({
      ...tag,
      usageCount: tagUsage(ctx.db, tag.id, input.entityType),
    }))
    .filter((row) => !input.entityType || row.usageCount > 0);
  return listRows(rows, input, tagSpec);
}
