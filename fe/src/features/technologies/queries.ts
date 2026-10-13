import "server-only";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_VALUES,
  listFiltersSchema,
  sortsBy,
} from "@/lib/validators/common";
import {
  TECHNOLOGY_SORT_FIELDS,
  technologyFilterSchema,
  type TechnologyFilterInput,
} from "@/lib/validators/technologies";
import * as technologies from "@/mocks/services/technologies";
import { getServiceContext } from "@/server/context";

type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The technology table's list filter from its URL (`?page&pageSize&sort&q&filters=<json>`, the keys the
 * data-table kit writes). Invalid parts are dropped one by one, so a hand-edited URL still renders the table.
 * Server only: the kit's own URL parsers live in a client module and cannot run here.
 */
export function technologyFilterFromParams(params: RawSearchParams): TechnologyFilterInput {
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
  const candidate = {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZE_VALUES.find((size) => size === pageSize) ?? DEFAULT_PAGE_SIZE,
    sort: sort && sortsBy(sort, TECHNOLOGY_SORT_FIELDS) ? sort : undefined,
    q: q ? q.slice(0, 200) : undefined,
    category: values.category,
    active: values.active,
  };
  const parsed = technologyFilterSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { page: 1, pageSize: DEFAULT_PAGE_SIZE };
}

/** Settings → Tecnologías table: the rows of one page, with their usage counts. */
export async function listTechnologies(filter: TechnologyFilterInput = {}) {
  return technologies.listTechnologies(await getServiceContext(), technologyFilterSchema.parse(filter));
}

/** One technology with its usage count; `NOT_FOUND` when it does not exist. */
export async function getTechnology(id: string) {
  return technologies.getTechnology(await getServiceContext(), { id });
}

/**
 * Active technologies for the stack picker (HU-06 CA1): every active one in one page, by name. The catalog
 * is small (Settings), so the picker never pages.
 */
export async function listActiveTechnologies() {
  const page = await listTechnologies({ active: true, pageSize: 100, sort: "name:asc" });
  return page.items;
}
