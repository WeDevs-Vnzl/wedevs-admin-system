"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
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
  const locale = useLocale();
  const active = facets.filter((facet) => (values[facet.id] ?? []).length > 0);

  return (
    <>
      {active.map((facet) => {
        const value = values[facet.id] ?? [];
        const summary = summarize(facet, value, labels, locale, (from, to) =>
          t("filters.range", { from, to }),
        );
        return (
          <Badge key={facet.id} variant="secondary" className="h-7 gap-1 pr-1 font-normal">
            <span className="text-muted-foreground">{t("filters.chipLabel", { field: facet.label })}</span>
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

/** A date-only facet value as a localized date; a malformed URL value is shown as typed. */
function localizedDay(value: string, locale: string): string {
  try {
    return formatDate(value, locale, "medium");
  } catch {
    return value;
  }
}

/**
 * Text of a chip's value. Date ranges are formatted for `locale`; `formatRange` builds the "from – to"
 * text through the `table` ICU messages, so no separator lives in code.
 */
export function summarize(
  facet: FacetConfig,
  value: FacetValue,
  labels: FacetLabelCache,
  locale: string,
  formatRange: (from: string, to: string) => string,
): string {
  if (facet.kind === "dateRange") {
    const [from, to] = value;
    if (value.length === 2 && from !== undefined && to !== undefined) {
      return formatRange(localizedDay(from, locale), localizedDay(to, locale));
    }
    return value.map((day) => localizedDay(day, locale)).join(", ");
  }
  return value.map((item) => labels.get(item) ?? item).join(", ");
}
