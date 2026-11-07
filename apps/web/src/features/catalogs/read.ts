import type { ExchangeRateListQuery } from "@/lib/api/types/catalogs";
import type { ExchangeRateFilters } from "@/lib/validators/catalogs";
import { toActionResult, type ApiActionError, type ApiResponseLike } from "@/lib/api/errors";

/** A failed catalog read: carries the mapped error envelope so an error boundary can show the right state. */
export class CatalogReadError extends Error {
  constructor(readonly error: ApiActionError) {
    super(error.message);
    this.name = "CatalogReadError";
  }
}

/** `openapi-fetch` result → data. A failed read throws `CatalogReadError` (the BE's error, never hidden). */
export function unwrap<T>(result: ApiResponseLike<T>): T {
  const mapped = toActionResult(result);
  if (!mapped.ok) throw new CatalogReadError(mapped.error);
  return mapped.data;
}

/** The rates table filter → the BE's query params (`archived` does not apply to rates). */
export function toExchangeRateQuery(filter: Partial<ExchangeRateFilters>): ExchangeRateListQuery {
  return {
    page: filter.page,
    pageSize: filter.pageSize,
    sort: filter.sort as ExchangeRateListQuery["sort"],
    q: filter.q,
    currency: filter.currency,
    source: filter.source,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
  };
}
