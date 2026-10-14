import { toModuleQuery } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import type { paymentFiltersSchema } from "@/lib/validators/payments";
import type { z } from "@/lib/validators/zod";
import { PAYMENT_FACETS } from "../columns";

/** Input of `paymentFiltersSchema` (the schema still coerces it: a scalar facet becomes a list). */
export type PaymentFilterInput = z.input<typeof paymentFiltersSchema>;

/**
 * The table's list query as the payments filter: facets go to their module keys (`date` → `dateFrom` /
 * `dateTo`). Shared by the server page and the table, so the first page and the reloads read the same filter.
 */
export function paymentFilterOf(query: Partial<ListQuery>): PaymentFilterInput {
  return toModuleQuery(
    { page: 1, pageSize: 25, filters: {}, ...query } as ListQuery,
    PAYMENT_FACETS,
  ) as PaymentFilterInput;
}
