// MOCK — catalog services of Hito 1 (PRD §12 `settings`, §9.2). `fn(ctx, input)`, framework-free (C11).
// Replaced by `src/server/services/catalogs.service.ts` (and its siblings) in Hito 2 (C9).
import { diffFields } from "@/lib/activity-diff";
import type { ActivityChanges } from "@/lib/validators/activity";
import { selectRate, type SelectedRate } from "@/lib/rates";
import type { Paginated } from "@/lib/validators/common";
import type {
  CreateCurrencyInput,
  CreateExpenseCategoryInput,
  CreatePaymentMethodInput,
  CurrencyDTO,
  CurrencyListInput,
  ExchangeRateDTO,
  ExchangeRateFilters,
  ExpenseCategoryDTO,
  ExpenseCategoryListInput,
  ExpenseCategoryTreeNode,
  GetRateForInput,
  ImportRatesCsvInput,
  ImportRatesCsvResult,
  PaymentMethodDTO,
  PaymentMethodListInput,
  QuickRateLoadInput,
  UpdateCurrencyInput,
  UpdateExpenseCategoryInput,
  UpdatePaymentMethodInput,
  UpsertExchangeRateInput,
} from "@/lib/validators/catalogs";
import type { FiscalSettings } from "@/lib/validators/settings";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockId } from "../ids";
import type { MockStore } from "../store";
import { logActivity, mockTx } from "./activity";
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

// Moved to their own service (H1-B4); re-exported under the same names for the documents callers.
export { listDocumentCategories, listDocumentTypes } from "./document-types";

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

// ───────────────────────────── Settings writes (Owner and Admin, `settings`) ─────────────────────────────

// Catalog rows are never deleted (C19): a currency, payment method or expense category in use is retired by
// deactivating it, which hides it from pickers while keeping every record that points at it readable.

const MESSAGES = {
  currencyCodeTaken: "catalogs.currencies.errors.codeTaken",
  usdAlwaysActive: "catalogs.currencies.errors.usdAlwaysActive",
  unknownCurrency: "catalogs.rates.errors.unknownCurrency",
  methodCodeTaken: "catalogs.paymentMethods.errors.codeTaken",
  methodNameTaken: "catalogs.paymentMethods.errors.nameTaken",
  categoryNameTaken: "catalogs.expenseCategories.errors.nameTaken",
  parentNotRoot: "catalogs.expenseCategories.errors.parentNotRoot",
  hasChildren: "catalogs.expenseCategories.errors.hasChildren",
} as const;

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

// ── Currencies ──

export async function createCurrency(
  ctx: MockServiceContext,
  input: CreateCurrencyInput,
): Promise<CurrencyDTO> {
  if (ctx.db.currencies.some((currency) => currency.code === input.code)) {
    throw new ServiceError("CONFLICT", { fieldErrors: { code: [MESSAGES.currencyCodeTaken] } });
  }
  const row: CurrencyDTO = { ...input };
  ctx.db.currencies.push(row);
  await logSettingsChange(ctx, row.code, row.name, { currency: [null, row.code] });
  return structuredClone(row);
}

/** Edits name, symbol, decimals and the active flag; the code is the key and never changes. */
export async function updateCurrency(
  ctx: MockServiceContext,
  input: UpdateCurrencyInput,
): Promise<CurrencyDTO> {
  const row = ctx.db.currencies.find((currency) => currency.code === input.code);
  if (!row) throw new ServiceError("NOT_FOUND");
  // USD is the reference of every rate (PRD §9.2): it cannot be retired.
  if (row.code === "USD" && !input.active) {
    throw new ServiceError("VALIDATION", { fieldErrors: { active: [MESSAGES.usdAlwaysActive] } });
  }
  const before = { ...row };
  Object.assign(row, input);
  const changes = diffFields(before, row, { fields: ["name", "symbol", "decimals", "active"] });
  await logSettingsChange(ctx, row.code, row.name, changes);
  return structuredClone(row);
}

// ── Exchange rates (DT-67: one rate per date + currency + source) ──

const exchangeRateSpec: ListSpec<ExchangeRateDTO> = {
  searchText: (row) => [row.currency, row.date],
  sorters: {
    date: (row) => row.date,
    currency: (row) => row.currency,
    usdRate: (row) => Number(row.usdRate),
    source: (row) => row.source,
    createdAt: (row) => row.createdAt,
  },
  defaultSort: "date:desc",
};

/** Settings → Tasas table: every stored rate, newest date first, by currency, source and date range. */
export async function listExchangeRates(
  ctx: MockServiceContext,
  input: ExchangeRateFilters,
): Promise<Paginated<ExchangeRateDTO>> {
  const rows = ctx.db.exchangeRates
    .filter((row) => !input.currency || input.currency.includes(row.currency))
    .filter((row) => !input.source || input.source.includes(row.source))
    .filter((row) => !input.dateFrom || row.date >= input.dateFrom)
    .filter((row) => !input.dateTo || row.date <= input.dateTo);
  const page = listRows(rows, input, exchangeRateSpec);
  return { ...page, items: structuredClone(page.items) };
}

function isKnownCurrency(db: MockStore, code: string): boolean {
  return db.currencies.some((currency) => currency.code === code);
}

/** Writes one rate without checks: inserts a new key or replaces the rate of an existing one. */
function writeRate(
  ctx: MockServiceContext,
  input: { date: string; currency: string; usdRate: string; source: ExchangeRateDTO["source"] },
): { rate: ExchangeRateDTO; created: boolean } {
  const existing = ctx.db.exchangeRates.find(
    (row) =>
      row.date === input.date && row.currency === input.currency && row.source === input.source,
  );
  if (existing) {
    existing.usdRate = input.usdRate;
    return { rate: existing, created: false };
  }
  const rate: ExchangeRateDTO = {
    id: nextMockId(ctx.db.idCounters, "rte", (id) =>
      ctx.db.exchangeRates.some((row) => row.id === id),
    ),
    date: input.date,
    currency: input.currency,
    usdRate: input.usdRate,
    source: input.source,
    createdAt: ctx.now.toISOString(),
    createdById: ctx.user.id,
  };
  ctx.db.exchangeRates.push(rate);
  return { rate, created: true };
}

/**
 * Saves the rate of a date, currency and source (unique together, DT-67): the same key updates the rate,
 * another source adds a row next to it. Snapshots already taken by transactions never change (§9.2).
 */
export async function upsertExchangeRate(
  ctx: MockServiceContext,
  input: UpsertExchangeRateInput,
): Promise<{ rate: ExchangeRateDTO; created: boolean }> {
  if (!isKnownCurrency(ctx.db, input.currency)) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { currency: [MESSAGES.unknownCurrency] },
    });
  }
  const result = writeRate(ctx, input);
  await logSettingsChange(ctx, result.rate.id, `${input.currency} ${input.date}`, {
    [`rate.${input.source}`]: [null, input.usdRate],
  });
  return { rate: structuredClone(result.rate), created: result.created };
}

/** Quick daily load (PRD §8.15): several currencies for one date and source, all or nothing. */
export async function loadDailyRates(
  ctx: MockServiceContext,
  input: QuickRateLoadInput,
): Promise<{ created: number; updated: number }> {
  const fieldErrors: Record<string, string[]> = {};
  input.rates.forEach((row, index) => {
    if (!isKnownCurrency(ctx.db, row.currency)) {
      fieldErrors[`rates.${index}.currency`] = [MESSAGES.unknownCurrency];
    }
  });
  if (Object.keys(fieldErrors).length > 0) throw new ServiceError("VALIDATION", { fieldErrors });

  let created = 0;
  for (const row of input.rates) {
    if (writeRate(ctx, { ...row, date: input.date, source: input.source }).created) created += 1;
  }
  await logSettingsChange(ctx, `rates-${input.date}`, input.date, {
    [`rates.${input.source}`]: [null, input.rates.map((row) => row.currency).join(", ")],
  });
  return { created, updated: input.rates.length - created };
}

/**
 * CSV import (PRD §8.15). Each row is a date + currency + source key: new keys are created, existing ones are
 * skipped, or updated with `overwrite`. Rows with a currency outside the catalog are reported by their
 * 1-based position in `rows` and the rest is imported.
 */
export async function importRatesCsv(
  ctx: MockServiceContext,
  input: ImportRatesCsvInput,
): Promise<ImportRatesCsvResult> {
  const result: ImportRatesCsvResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  input.rows.forEach((row, index) => {
    if (!isKnownCurrency(ctx.db, row.currency)) {
      result.errors.push({ row: index + 1, messages: [MESSAGES.unknownCurrency] });
      return;
    }
    const exists = ctx.db.exchangeRates.some(
      (rate) =>
        rate.date === row.date && rate.currency === row.currency && rate.source === row.source,
    );
    if (exists && !input.overwrite) {
      result.skipped += 1;
      return;
    }
    if (writeRate(ctx, row).created) result.created += 1;
    else result.updated += 1;
  });
  if (result.created + result.updated > 0) {
    await logSettingsChange(ctx, "rates-import", "CSV", {
      ratesImported: [null, String(result.created + result.updated)],
    });
  }
  return result;
}

// ── Fiscal ──

/**
 * Replaces the fiscal parameters: allowed VAT rates and the default one (DT-44), IGTF rate and the
 * currencies that propose it (DT-70, together with `PaymentMethod.suggestsIgtf`), default due days.
 */
export async function updateFiscalSettings(
  ctx: MockServiceContext,
  input: FiscalSettings,
): Promise<FiscalSettings> {
  if (input.igtfCurrencies.some((code) => !isKnownCurrency(ctx.db, code))) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { igtfCurrencies: [MESSAGES.unknownCurrency] },
    });
  }
  const before = ctx.db.fiscal;
  ctx.db.fiscal = structuredClone(input);
  const changes = diffFields(before, ctx.db.fiscal, {
    fields: [
      "ivaRates",
      "ivaDefaultRate",
      "igtfRate",
      "igtfCurrencies",
      "igtfMethodCodes",
      "invoiceDefaultDueDays",
    ],
  });
  await logSettingsChange(ctx, "fiscal", "fiscal", changes);
  return structuredClone(ctx.db.fiscal);
}

// ── Payment methods ──

function assertUniqueMethod(
  ctx: MockServiceContext,
  input: { code?: string; name: string },
  exceptId?: string,
): void {
  const others = ctx.db.paymentMethods.filter((method) => method.id !== exceptId);
  const fieldErrors: Record<string, string[]> = {};
  if (input.code && others.some((method) => method.code === input.code)) {
    fieldErrors.code = [MESSAGES.methodCodeTaken];
  }
  if (others.some((method) => sameText(method.name, input.name))) {
    fieldErrors.name = [MESSAGES.methodNameTaken];
  }
  if (Object.keys(fieldErrors).length > 0) throw new ServiceError("CONFLICT", { fieldErrors });
}

export async function createPaymentMethod(
  ctx: MockServiceContext,
  input: CreatePaymentMethodInput,
): Promise<PaymentMethodDTO> {
  assertUniqueMethod(ctx, input);
  const row: PaymentMethodDTO = {
    id: nextMockId(ctx.db.idCounters, "pmt", (id) =>
      ctx.db.paymentMethods.some((method) => method.id === id),
    ),
    code: input.code,
    name: input.name,
    nameEn: input.nameEn ?? null,
    requiresReference: input.requiresReference,
    suggestsIgtf: input.suggestsIgtf,
    active: input.active,
  };
  ctx.db.paymentMethods.push(row);
  await logSettingsChange(ctx, row.id, row.name, { paymentMethod: [null, row.code] });
  return structuredClone(row);
}

/** Edits a payment method; its code is the stable identifier and never changes. */
export async function updatePaymentMethod(
  ctx: MockServiceContext,
  input: UpdatePaymentMethodInput,
): Promise<PaymentMethodDTO> {
  const row = ctx.db.paymentMethods.find((method) => method.id === input.id);
  if (!row) throw new ServiceError("NOT_FOUND");
  assertUniqueMethod(ctx, { name: input.name }, row.id);
  const before = { ...row };
  Object.assign(row, {
    name: input.name,
    nameEn: input.nameEn ?? null,
    requiresReference: input.requiresReference,
    suggestsIgtf: input.suggestsIgtf,
    active: input.active,
  });
  const changes = diffFields(before, row, {
    fields: ["name", "nameEn", "requiresReference", "suggestsIgtf", "active"],
  });
  await logSettingsChange(ctx, row.id, row.name, changes);
  return structuredClone(row);
}

// ── Expense categories (two levels, PRD §8.8) ──

/**
 * Tree rules: the parent must be an existing root (depth ≤ 2), a root with children stays a root, and names
 * are unique among siblings (case-insensitive).
 */
function assertCategoryPlacement(
  ctx: MockServiceContext,
  input: { name: string; parentId?: string | undefined },
  self?: ExpenseCategoryDTO,
): void {
  const parentId = input.parentId ?? null;
  if (parentId !== null) {
    const parent = ctx.db.expenseCategories.find((category) => category.id === parentId);
    if (!parent || parent.parentId !== null) {
      throw new ServiceError("VALIDATION", { fieldErrors: { parentId: [MESSAGES.parentNotRoot] } });
    }
    if (self && ctx.db.expenseCategories.some((category) => category.parentId === self.id)) {
      throw new ServiceError("VALIDATION", { fieldErrors: { parentId: [MESSAGES.hasChildren] } });
    }
  }
  const siblingTaken = ctx.db.expenseCategories.some(
    (category) =>
      category.id !== self?.id &&
      category.parentId === parentId &&
      sameText(category.name, input.name),
  );
  if (siblingTaken) {
    throw new ServiceError("CONFLICT", { fieldErrors: { name: [MESSAGES.categoryNameTaken] } });
  }
}

export async function createExpenseCategory(
  ctx: MockServiceContext,
  input: CreateExpenseCategoryInput,
): Promise<ExpenseCategoryDTO> {
  assertCategoryPlacement(ctx, input);
  const row: ExpenseCategoryDTO = {
    id: nextMockId(ctx.db.idCounters, "ecat", (id) =>
      ctx.db.expenseCategories.some((category) => category.id === id),
    ),
    name: input.name,
    nameEn: input.nameEn ?? null,
    color: input.color ?? null,
    parentId: input.parentId ?? null,
    active: input.active,
  };
  ctx.db.expenseCategories.push(row);
  await logSettingsChange(ctx, row.id, row.name, { expenseCategory: [null, row.name] });
  return structuredClone(row);
}

export async function updateExpenseCategory(
  ctx: MockServiceContext,
  input: UpdateExpenseCategoryInput,
): Promise<ExpenseCategoryDTO> {
  const row = ctx.db.expenseCategories.find((category) => category.id === input.id);
  if (!row) throw new ServiceError("NOT_FOUND");
  assertCategoryPlacement(ctx, input, row);
  const before = { ...row };
  Object.assign(row, {
    name: input.name,
    nameEn: input.nameEn ?? null,
    color: input.color ?? null,
    parentId: input.parentId ?? null,
    active: input.active,
  });
  const changes = diffFields(before, row, {
    fields: ["name", "nameEn", "color", "parentId", "active"],
  });
  await logSettingsChange(ctx, row.id, row.name, changes);
  return structuredClone(row);
}
