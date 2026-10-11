import { toModuleQuery } from "@/lib/table-query";
import { listFiltersSchema, listQuerySchema, type ListQuery } from "@/lib/validators/common";
import { projectFilterSchema, type ProjectFilterInput } from "@/lib/validators/projects";
import { PROJECT_FACETS } from "./columns";

/**
 * The table's query as the projects list filter: facets flatten to the top-level keys the schema takes
 * (`delivery` → `deliveryFrom` / `deliveryTo`). Invalid parts fall back to the defaults, so a hand-edited
 * query still renders the table.
 */
export function toProjectFilter(query: ListQuery): ProjectFilterInput {
  const parsed = projectFilterSchema.safeParse(toModuleQuery(query, PROJECT_FACETS));
  return parsed.success ? parsed.data : { page: query.page, pageSize: query.pageSize };
}

type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Server side: the list filter of `/projects/list?page&pageSize&sort&q&filters=<json>` (the kit's keys). */
export function projectFilterFromParams(params: RawSearchParams): ProjectFilterInput {
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
  const query = listQuerySchema.safeParse({
    page: first(params.page),
    pageSize: first(params.pageSize),
    sort: first(params.sort),
    q: first(params.q),
    filters: facets.success ? facets.data : {},
  });
  return toProjectFilter(query.success ? query.data : listQuerySchema.parse({}));
}
