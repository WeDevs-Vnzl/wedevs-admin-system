"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ListFilters, ListQuery } from "@/lib/validators/common";
import { DataTableExportButton } from "./data-table-export-button";
import { DataTableFacetedFilter, type FacetLabelCache, type FacetValue } from "./data-table-faceted-filter";
import { DataTableFilterChips } from "./data-table-filter-chips";
import { DataTableSearch } from "./data-table-search";
import { DataTableViewOptions, type ViewColumn } from "./data-table-view-options";
import type { ColumnConfig, FacetConfig, ListQueryPatch } from "./types";

interface DataTableToolbarProps {
  query: ListQuery;
  onQueryChange: (patch: ListQueryPatch) => void;
  facets: FacetConfig[];
  searchPlaceholder?: string;
  showArchivedToggle: boolean;
  viewColumns: ViewColumn[];
  columnConfig: ColumnConfig[];
  defaultColumnConfig: ColumnConfig[];
  onColumnConfigChange: (config: ColumnConfig[]) => void;
  /** When set, the export button is shown and calls this with the query and visible column ids. */
  onExport?: () => void;
}

/** Normalises a stored filter (string or string[]) to the facet value shape. */
export function facetValuesOf(filters: ListFilters): Record<string, FacetValue> {
  return Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? value : [value]]),
  );
}

/** Search, "+ Field" facets with their chips, "Limpiar", archived toggle, view options and export. */
export function DataTableToolbar({
  query,
  onQueryChange,
  facets,
  searchPlaceholder,
  showArchivedToggle,
  viewColumns,
  columnConfig,
  defaultColumnConfig,
  onColumnConfigChange,
  onExport,
}: DataTableToolbarProps) {
  const t = useTranslations("table");
  const archivedId = useId();
  const [labels] = useState<FacetLabelCache>(() => new Map());
  const values = facetValuesOf(query.filters);
  const hasActive =
    Object.keys(query.filters).length > 0 || query.q !== undefined || query.includeArchived;

  const changeFacet = (facetId: string, value: FacetValue) => {
    const filters = { ...query.filters };
    if (value.length > 0) filters[facetId] = value;
    else delete filters[facetId];
    onQueryChange({ filters });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DataTableSearch
        value={query.q}
        placeholder={searchPlaceholder}
        onChange={(q) => onQueryChange({ q })}
      />
      {facets.map((facet) => (
        <DataTableFacetedFilter
          key={facet.id}
          facet={facet}
          value={values[facet.id] ?? []}
          labels={labels}
          onChange={(value) => changeFacet(facet.id, value)}
        />
      ))}
      <DataTableFilterChips facets={facets} values={values} labels={labels} onChange={changeFacet} />
      {hasActive ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onQueryChange({ filters: {}, q: undefined, includeArchived: false })}
        >
          {t("filters.clear")}
        </Button>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {showArchivedToggle ? (
          <div className="flex items-center gap-2">
            <Switch
              id={archivedId}
              checked={query.includeArchived}
              onCheckedChange={(checked) => onQueryChange({ includeArchived: checked === true })}
            />
            <Label htmlFor={archivedId} className="font-normal">
              {t("archived.toggle")}
            </Label>
          </div>
        ) : null}
        <DataTableViewOptions
          columns={viewColumns}
          config={columnConfig}
          defaults={defaultColumnConfig}
          onChange={onColumnConfigChange}
        />
        {onExport ? <DataTableExportButton onExport={onExport} /> : null}
      </div>
    </div>
  );
}
