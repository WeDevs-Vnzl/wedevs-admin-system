import "server-only";
import { getServerApi } from "@/lib/api/server";
import type {
  DocumentTypeListQuery,
  TagListQuery,
  TechnologyListQuery,
} from "@/lib/api/types/catalogs";
import { todayInCaracas } from "@/lib/dates";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_VALUES,
  listFiltersSchema,
  sortsBy,
  type Paginated,
} from "@/lib/validators/common";
import {
  EXCHANGE_RATE_SORT_FIELDS,
  currencyListInputSchema,
  exchangeRateFiltersSchema,
  expenseCategoryListInputSchema,
  getRateForInputSchema,
  paymentMethodListInputSchema,
  type CurrencyDTO,
  type CurrencyListInputRaw,
  type ExchangeRateDTO,
  type ExchangeRateFilters,
  type ExpenseCategoryListInputRaw,
  type ExpenseCategoryTreeNode,
  type GetRateForInput,
  type PaymentMethodDTO,
  type PaymentMethodListInputRaw,
} from "@/lib/validators/catalogs";
import {
  documentTypeFilterSchema,
  type DocumentCategoryDetailDTO,
  type DocumentTypeFilterInput,
  type DocumentTypeListRowDTO,
} from "@/lib/validators/document-types";
import type { SelectedRate } from "@/lib/rates";
import type { FiscalSettings } from "@/lib/validators/settings";
import { tagFilterSchema, type TagFilterInput, type TagListRowDTO } from "@/lib/validators/tags";
import {
  technologyFilterSchema,
  type TechnologyFilterInput,
  type TechnologyListRowDTO,
} from "@/lib/validators/technologies";
import { toExchangeRateQuery, unwrap } from "./read";

// Reference data every signed-in role needs to fill a form (currencies, methods, technologies, tags…).
// Managing it is a different matter: that goes through the `settings` actions (Owner and Admin).

/** The lookup behind `lookupRateAction`: `null` when no rate exists on or before the date. */
export async function getRateFor(input: GetRateForInput): Promise<SelectedRate | null> {
  const { date, currency } = getRateForInputSchema.parse(input);
  const api = await getServerApi();
  const { rate } = unwrap(
    await api.GET("/api/v1/exchange-rates/lookup", { params: { query: { date, currency } } }),
  );
  return rate;
}

/** `includeInactive` goes out only when set: pickers get the active rows (the BE default). */
const inactiveQuery = (includeInactive: boolean) => (includeInactive ? { includeInactive } : {});

// Pickers get the active rows only; the Settings screens pass `{ includeInactive: true }` (m-g).

export async function listCurrencies(input: CurrencyListInputRaw = {}): Promise<CurrencyDTO[]> {
  const { includeInactive } = currencyListInputSchema.parse(input);
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/currencies", {
      params: { query: inactiveQuery(includeInactive) },
    }),
  );
}

export async function listPaymentMethods(
  input: PaymentMethodListInputRaw = {},
): Promise<PaymentMethodDTO[]> {
  const { includeInactive } = paymentMethodListInputSchema.parse(input);
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/payment-methods", {
      params: { query: inactiveQuery(includeInactive) },
    }),
  );
}

export async function listExpenseCategories(
  input: ExpenseCategoryListInputRaw = {},
): Promise<ExpenseCategoryTreeNode[]> {
  const { includeInactive } = expenseCategoryListInputSchema.parse(input);
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/expense-categories", {
      params: { query: inactiveQuery(includeInactive) },
    }),
  );
}

/** Fiscal parameters, incl. `ivaRates`: the source of the allowed VAT rates in invoice forms (C17). */
export async function getFiscalSettings(): Promise<FiscalSettings> {
  const api = await getServerApi();
  const fiscal = unwrap(await api.GET("/api/v1/settings/fiscal"));
  // The BE has no per-method IGTF code list (a method proposes IGTF through `suggestsIgtf`, DT-70).
  return { ...fiscal, igtfMethodCodes: [] };
}

// ───────────────────────────── Picker reads (taxonomy owns the writes) ─────────────────────────────

const archivedOf = (includeArchived: boolean) => (includeArchived ? "include" : "exclude");

export async function listTags(filter: TagFilterInput = {}): Promise<Paginated<TagListRowDTO>> {
  const { page, pageSize, sort, q, entityType, includeArchived } = tagFilterSchema.parse(filter);
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/tags", {
      params: {
        query: {
          page,
          pageSize,
          sort: sort as TagListQuery["sort"],
          q,
          entityType,
          archived: archivedOf(includeArchived),
        },
      },
    }),
  );
}

export async function listTechnologies(
  filter: TechnologyFilterInput = {},
): Promise<Paginated<TechnologyListRowDTO>> {
  const { page, pageSize, sort, q, category, active, includeArchived } =
    technologyFilterSchema.parse(filter);
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/technologies", {
      params: {
        query: {
          page,
          pageSize,
          sort: sort as TechnologyListQuery["sort"],
          q,
          category,
          active: (active === undefined
            ? undefined
            : String(active)) as TechnologyListQuery["active"],
          archived: archivedOf(includeArchived),
        },
      },
    }),
  );
}

export async function listDocumentCategories(): Promise<DocumentCategoryDetailDTO[]> {
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/document-categories"));
}

export async function listDocumentTypes(
  filter: DocumentTypeFilterInput = {},
): Promise<Paginated<DocumentTypeListRowDTO>> {
  const { page, pageSize, sort, q, categoryId, active, requiresSignature, hasExpiration } =
    documentTypeFilterSchema.parse(filter);
  const flag = (value: boolean | undefined) => (value === undefined ? undefined : String(value));
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/document-types", {
      params: {
        query: {
          page,
          pageSize,
          sort: sort as DocumentTypeListQuery["sort"],
          q,
          categoryId,
          active: flag(active),
          requiresSignature: flag(requiresSignature),
          hasExpiration: flag(hasExpiration),
        },
      },
    }),
  );
}

// ───────────────────────────── Settings → Tasas table ─────────────────────────────

type RawSearchParams = Record<string, string | string[] | undefined>;
type ExchangeRateFilterInput = Partial<ExchangeRateFilters>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The rates table's list filter from its URL (`?page&pageSize&sort&q&filters=<json>`, the keys the data-table
 * kit writes). Invalid parts are dropped one by one, so a hand-edited URL still renders the table.
 */
export function exchangeRateFilterFromParams(params: RawSearchParams): ExchangeRateFilterInput {
  let filters: unknown = {};
  const rawFilters = first(params.filters);
  if (rawFilters) {
    try {
      filters = JSON.parse(rawFilters);
    } catch {
      filters = {};
    }
  }
  const facets = listFiltersSchema.safeParse(filters);
  const values = facets.success ? facets.data : {};

  const page = Number(first(params.page));
  const pageSize = Number(first(params.pageSize));
  const sort = first(params.sort);
  const q = first(params.q);
  const candidate: Record<string, unknown> = {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZE_VALUES.find((size) => size === pageSize) ?? DEFAULT_PAGE_SIZE,
  };
  if (sort && sortsBy(sort, EXCHANGE_RATE_SORT_FIELDS)) candidate.sort = sort;
  if (q) candidate.q = q.slice(0, 200);
  // Each facet is kept only when it parses on its own.
  for (const facet of ["currency", "source"] as const) {
    const value = values[facet];
    if (value === undefined) continue;
    if (exchangeRateFiltersSchema.safeParse({ ...candidate, [facet]: value }).success) {
      candidate[facet] = value;
    }
  }
  return exchangeRateFiltersSchema.safeParse(candidate).success
    ? (candidate as ExchangeRateFilterInput)
    : { page: 1, pageSize: DEFAULT_PAGE_SIZE };
}

export type QuickLoadCurrency = {
  code: string;
  name: string;
  /** Latest rate on or before `today` (any source), for the deviation warning (PRD §15). */
  lastRate: { usdRate: string; date: string } | null;
};

/** Quick daily load: today's date and the active non-USD currencies with their latest rate. */
export async function getQuickLoadContext(): Promise<{
  today: string;
  currencies: QuickLoadCurrency[];
}> {
  const today = todayInCaracas(new Date());
  const currencies = await listCurrencies();
  const rows = await Promise.all(
    currencies
      .filter((currency) => currency.code !== "USD")
      .map(async (currency) => {
        const rate = await getRateFor({ date: today, currency: currency.code });
        return {
          code: currency.code,
          name: currency.name,
          lastRate: rate ? { usdRate: rate.usdRate, date: rate.effectiveDate } : null,
        };
      }),
  );
  return { today, currencies: rows };
}

/** Settings → Tasas table: one page of stored rates, newest date first. */
export async function listExchangeRates(
  input: ExchangeRateFilterInput = {},
): Promise<Paginated<ExchangeRateDTO>> {
  const filter = exchangeRateFiltersSchema.parse(input);
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/exchange-rates", { params: { query: toExchangeRateQuery(filter) } }),
  );
}
