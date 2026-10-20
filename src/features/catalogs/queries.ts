import "server-only";
import { todayInCaracas } from "@/lib/dates";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_VALUES,
  listFiltersSchema,
  sortsBy,
} from "@/lib/validators/common";
import {
  EXCHANGE_RATE_SORT_FIELDS,
  currencyListInputSchema,
  exchangeRateFiltersSchema,
  expenseCategoryListInputSchema,
  getRateForInputSchema,
  paymentMethodListInputSchema,
  type CurrencyListInputRaw,
  type ExchangeRateFilters,
  type ExpenseCategoryListInputRaw,
  type GetRateForInput,
  type PaymentMethodListInputRaw,
} from "@/lib/validators/catalogs";
import {
  documentTypeFilterSchema,
  type DocumentTypeFilterInput,
} from "@/lib/validators/document-types";
import { tagFilterSchema, type TagFilterInput } from "@/lib/validators/tags";
import { technologyFilterSchema, type TechnologyFilterInput } from "@/lib/validators/technologies";
import * as catalogs from "@/mocks/services/catalogs";
import { getServiceContext } from "@/server/context";

// Reference data every signed-in role needs to fill a form (currencies, methods, technologies, tags…).
// Managing it is a different matter: that goes through the `settings` actions (Owner and Admin).

export async function getRateFor(input: GetRateForInput) {
  return catalogs.getRateFor(await getServiceContext(), getRateForInputSchema.parse(input));
}

// Pickers get the active rows only; the Settings screens pass `{ includeInactive: true }` (m-g).

export async function listCurrencies(input: CurrencyListInputRaw = {}) {
  return catalogs.listCurrencies(await getServiceContext(), currencyListInputSchema.parse(input));
}

export async function listPaymentMethods(input: PaymentMethodListInputRaw = {}) {
  return catalogs.listPaymentMethods(
    await getServiceContext(),
    paymentMethodListInputSchema.parse(input),
  );
}

export async function listTechnologies(filter: TechnologyFilterInput = {}) {
  return catalogs.listTechnologies(await getServiceContext(), technologyFilterSchema.parse(filter));
}

export async function listDocumentCategories() {
  return catalogs.listDocumentCategories(await getServiceContext());
}

export async function listDocumentTypes(filter: DocumentTypeFilterInput = {}) {
  return catalogs.listDocumentTypes(
    await getServiceContext(),
    documentTypeFilterSchema.parse(filter),
  );
}

export async function listExpenseCategories(input: ExpenseCategoryListInputRaw = {}) {
  return catalogs.listExpenseCategories(
    await getServiceContext(),
    expenseCategoryListInputSchema.parse(input),
  );
}

export async function listTags(filter: TagFilterInput = {}) {
  return catalogs.listTags(await getServiceContext(), tagFilterSchema.parse(filter));
}

/** Fiscal parameters, incl. `ivaRates`: the source of the allowed VAT rates in invoice forms (C17). */
export async function getFiscalSettings() {
  return catalogs.getFiscalSettings(await getServiceContext());
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
  const ctx = await getServiceContext();
  const today = todayInCaracas(ctx.now);
  const currencies = await catalogs.listCurrencies(ctx, currencyListInputSchema.parse({}));
  const rows = await Promise.all(
    currencies
      .filter((currency) => currency.code !== "USD")
      .map(async (currency) => {
        const rate = await catalogs.getRateFor(ctx, { date: today, currency: currency.code });
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
export async function listExchangeRates(input: ExchangeRateFilterInput = {}) {
  return catalogs.listExchangeRates(
    await getServiceContext(),
    exchangeRateFiltersSchema.parse(input),
  );
}
