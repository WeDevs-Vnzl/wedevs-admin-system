import type { ReactNode } from "react";
import type { DateRangeFacetKeys } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";

export interface ColumnConfig {
  id: string;
  visible: boolean;
  /** Pixel width set by the user (resize handle or view options); `undefined` keeps the default. */
  width?: number;
}

export interface FacetOption {
  value: string;
  label: string;
}

interface FacetBase {
  /** Filter key in `ListQuery.filters` (and `?filters=` in the URL). */
  id: string;
  /** Translated label of the "+ Field" button. */
  label: string;
}

/**
 * Facet kinds. `options` = static list; `async` = options loaded per search string (clients, tags…);
 * `dateRange` = `[from, to]` as `YYYY-MM-DD`, sent to the module query as `fromKey` / `toKey`
 * (default `<id>From` / `<id>To`, see `toModuleQuery`).
 */
export type FacetConfig =
  | (FacetBase & { kind: "options"; options: FacetOption[] })
  | (FacetBase & { kind: "async"; loadOptions: (search: string) => Promise<FacetOption[]> })
  | (FacetBase & { kind: "dateRange" } & DateRangeFacetKeys);

/** Partial update of the list query; the kit resets `page` to 1 whenever a filter/search/sort changes. */
export type ListQueryPatch = Partial<
  Pick<ListQuery, "page" | "pageSize" | "sort" | "q" | "filters" | "includeArchived">
>;

export interface DataTableEmptyConfig {
  title: string;
  description?: string;
  /** CTA slot (e.g. a "New client" button). */
  action?: ReactNode;
}
