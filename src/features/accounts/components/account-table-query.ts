import { toModuleQuery } from "@/lib/table-query";
import type { AccountFilterInput } from "@/lib/validators/accounts";
import type { ListQuery } from "@/lib/validators/common";
import { ACCOUNT_FACETS } from "../columns";

/**
 * The table's list query as the accounts filter. `/accounts/list` shows inactive accounts too (so they can be
 * reactivated); the status facet narrows them. Shared by the server page and the table.
 */
export function accountFilterOf(query: ListQuery): AccountFilterInput {
  return {
    ...(toModuleQuery(query, ACCOUNT_FACETS) as AccountFilterInput),
    includeInactive: true,
  };
}
