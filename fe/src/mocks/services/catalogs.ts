// MOCK — catalog services of Hito 1 (PRD §12 `settings`, §9.2). `fn(ctx, input)`, framework-free (C11).
// Replaced by `src/server/services/catalogs.service.ts` (and its siblings) in Hito 2 (C9).
import { selectRate, type SelectedRate } from "@/lib/rates";
import type { Paginated } from "@/lib/validators/common";
import type {
  CurrencyDTO,
  CurrencyListInput,
  ExpenseCategoryListInput,
  ExpenseCategoryTreeNode,
  GetRateForInput,
  PaymentMethodDTO,
  PaymentMethodListInput,
} from "@/lib/validators/catalogs";
import type {
  DocumentCategoryDetailDTO,
  DocumentTypeDetailDTO,
  DocumentTypeFilter,
  DocumentTypeListRowDTO,
} from "@/lib/validators/document-types";
import type { FiscalSettings } from "@/lib/validators/settings";
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

/** Active currencies; every currency with `includeInactive` (Settings). */
export async function listCurrencies(
  ctx: MockServiceContext,
  input: CurrencyListInput,
): Promise<CurrencyDTO[]> {
  return structuredClone(
    ctx.db.currencies.filter((currency) => input.includeInactive || currency.active),
  );
}

/** Active payment methods; every method with `includeInactive` (Settings). */
export async function listPaymentMethods(
  ctx: MockServiceContext,
  input: PaymentMethodListInput,
): Promise<PaymentMethodDTO[]> {
  return structuredClone(
    ctx.db.paymentMethods.filter((method) => input.includeInactive || method.active),
  );
}

export async function getFiscalSettings(ctx: MockServiceContext): Promise<FiscalSettings> {
  return structuredClone(ctx.db.fiscal);
}

// ───────────────────────────── Technologies and tags ─────────────────────────────

// Moved to their own services (H1-B2 catalog split); re-exported under the same names.
export { getTechnology, listTechnologies } from "./technologies";
export { getTag, listTags } from "./tags";

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
    documentCount: db.documents.filter((doc) => !doc.archivedAt && doc.typeId === row.id).length,
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

/**
 * Two-level tree: every root with its children, in catalog order (PRD §8.8). Inactive categories are left
 * out unless `includeInactive`; an inactive root takes its children with it.
 */
export async function listExpenseCategories(
  ctx: MockServiceContext,
  input: ExpenseCategoryListInput,
): Promise<ExpenseCategoryTreeNode[]> {
  const visible = (category: { active: boolean }): boolean =>
    input.includeInactive || category.active;
  return ctx.db.expenseCategories
    .filter((category) => category.parentId === null && visible(category))
    .map((root) => ({
      ...root,
      children: ctx.db.expenseCategories.filter(
        (child) => child.parentId === root.id && visible(child),
      ),
    }))
    .map((node) => structuredClone(node));
}
