import { toModuleQuery } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import { projectFilterSchema, type ProjectFilterInput } from "@/lib/validators/projects";
import { PROJECT_FACETS } from "./columns";

/**
 * The table's query as the projects list filter: facets flatten to the top-level keys the schema takes
 * (`delivery` → `deliveryFrom` / `deliveryTo`), `includeArchived` included. The server page and the table both
 * read the URL through `urlStateToListQuery`, which drops invalid parts one by one; a facet value the module
 * schema rejects falls back to the defaults, so a hand-edited query still renders the table.
 */
export function toProjectFilter(query: ListQuery): ProjectFilterInput {
  const parsed = projectFilterSchema.safeParse(toModuleQuery(query, PROJECT_FACETS));
  if (parsed.success) return parsed.data;
  // One bad facet value drops the facets only: search, sort, paging and the archived toggle stay.
  return projectFilterSchema.parse(toModuleQuery({ ...query, filters: {} }, PROJECT_FACETS));
}
