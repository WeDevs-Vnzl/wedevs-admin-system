import { toModuleQuery, type TableFacetDescriptor } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import type { UserFilterInput } from "@/lib/validators/users";

/** Facets of the `/settings/users` table, shared by the server page and the client table. */
export const USER_FACETS: readonly TableFacetDescriptor[] = [
  { id: "role", kind: "options" },
  { id: "status", kind: "options" },
];

/** The table's list query as the users filter. */
export function userFilterOf(query: ListQuery): UserFilterInput {
  return toModuleQuery(query, USER_FACETS) as UserFilterInput;
}
