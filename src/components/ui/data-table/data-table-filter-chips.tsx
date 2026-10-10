"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FacetLabelCache, FacetValue } from "./data-table-faceted-filter";
import type { FacetConfig } from "./types";

interface DataTableFilterChipsProps {
  facets: FacetConfig[];
  /** Active facet values by facet id (empty arrays are not active). */
  values: Record<string, FacetValue>;
  labels: FacetLabelCache;
  onChange: (facetId: string, value: FacetValue) => void;
}

/** One removable chip per active facet. Removing a chip clears only that facet. */
export function DataTableFilterChips({ facets, values, labels, onChange }: DataTableFilterChipsProps) {
  const t = useTranslations("table");
  const active = facets.filter((facet) => (values[facet.id] ?? []).length > 0);

  return (
    <>
      {active.map((facet) => {
        const value = values[facet.id] ?? [];
        const summary = summarize(facet, value, labels);
        return (
          <Badge key={facet.id} variant="secondary" className="h-7 gap-1 pr-1 font-normal">
            <span className="text-muted-foreground">{facet.label}:</span>
            <span className="max-w-48 truncate">{summary}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 rounded-full"
              onClick={() => onChange(facet.id, [])}
              aria-label={t("filters.remove", { field: facet.label })}
            >
              <X />
            </Button>
          </Badge>
        );
      })}
    </>
  );
}

export function summarize(facet: FacetConfig, value: FacetValue, labels: FacetLabelCache): string {
  if (facet.kind === "dateRange") return value.join(" – ");
  return value.map((item) => labels.get(item) ?? item).join(", ");
}
