import type { TableFacetDescriptor } from "@/lib/table-query";
import { toModuleQuery } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";

/**
 * Table query (`ListQuery`, the output of `fe/src/lib/table-query.ts`) → API query params
 * (`api-contract.md` §3, BE-0 choice a): `archived=exclude|only|include` instead of `includeArchived`,
 * flat resource filters instead of a `filters` map. Array values serialize as repeated keys in
 * `openapi-fetch`.
 */

export type ArchivedMode = "exclude" | "only" | "include";

export type ApiParamValue = string | number | string[];

export interface ApiListParams {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
  archived: ArchivedMode;
  [filter: string]: ApiParamValue | undefined;
}

export interface ListParamsOptions {
  /** A screen showing only archived records (Trash) asks for `only`; it wins over `includeArchived`. */
  archived?: ArchivedMode;
  /** Facet descriptors, to split date ranges into their `from`/`to` keys. */
  facets?: readonly TableFacetDescriptor[];
}

const OWN_KEYS = new Set(["page", "pageSize", "sort", "q", "archived", "includeArchived"]);

export function toApiListParams(query: ListQuery, options: ListParamsOptions = {}): ApiListParams {
  const flat = toModuleQuery(query, options.facets);
  const params: ApiListParams = {
    page: query.page,
    pageSize: query.pageSize,
    archived: options.archived ?? (query.includeArchived ? "include" : "exclude"),
  };
  if (query.sort !== undefined) params.sort = query.sort;
  if (query.q !== undefined) params.q = query.q;

  for (const [key, value] of Object.entries(flat)) {
    if (OWN_KEYS.has(key)) continue;
    if (typeof value === "string" || typeof value === "number") params[key] = value;
    else if (Array.isArray(value)) params[key] = value.map(String);
  }
  return params;
}
