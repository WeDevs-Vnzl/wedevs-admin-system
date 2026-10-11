import { toModuleQuery } from "@/lib/table-query";
import type { ClientFilterInput } from "@/lib/validators/clients";
import type { ListQuery } from "@/lib/validators/common";
import { CLIENT_FACETS } from "../columns";

/**
 * The table's list query as the clients filter: facets go to their module keys (`tagId`, `created` →
 * `createdFrom` / `createdTo`), exactly as the CSV export reads them. Shared by the server page and the table.
 */
export function clientFilterOf(query: ListQuery): ClientFilterInput {
  return toModuleQuery(query, CLIENT_FACETS) as ClientFilterInput;
}
