import {
  KPI_ID_VALUES,
  REPORT_ID_VALUES,
  reportFilterSchema,
  type KpiId,
  type ReportFilter,
  type ReportId,
} from "@/lib/validators/reports";

// Routes of `/reports` (PRD §8.13, §11): the ten financial reports and the eighteen KPIs each have a detail page at
// `/reports/<slug>`, the id in kebab case (`TAXES_REGISTERED` → `taxes-registered`). Report and KPI ids never
// collide, so one segment names either. Labels live in the `reports` namespace under `items.{reports,kpis}.<ID>`.

export type ReportPage = { kind: "report"; id: ReportId } | { kind: "kpi"; id: KpiId };

const toSlug = (id: string) => id.toLowerCase().replaceAll("_", "-");

const PAGES_BY_SLUG = new Map<string, ReportPage>([
  ...REPORT_ID_VALUES.map((id) => [toSlug(id), { kind: "report", id }] as const),
  ...KPI_ID_VALUES.map((id) => [toSlug(id), { kind: "kpi", id }] as const),
]);

/** The report or KPI a `/reports/<slug>` segment names, or `null` for an unknown slug. */
export function parseReportSlug(slug: string): ReportPage | null {
  return PAGES_BY_SLUG.get(slug) ?? null;
}

/** i18n key (namespace `reports`) of a report's or KPI's name. */
export function reportPageTitleKey(page: ReportPage): string {
  return `items.${page.kind === "report" ? "reports" : "kpis"}.${page.id}.title`;
}

export const DEFAULT_REPORT_FILTER: ReportFilter = reportFilterSchema.parse({});

/** Query string of the date range (`?preset=…`, plus `from`/`to` for a custom range). */
export function filterToQuery(filter: ReportFilter): string {
  const params = new URLSearchParams({ preset: filter.preset });
  if (filter.preset === "CUSTOM") {
    if (filter.dateFrom) params.set("from", filter.dateFrom);
    if (filter.dateTo) params.set("to", filter.dateTo);
  }
  return `?${params.toString()}`;
}

/** Reads the range from the page's search params; an invalid URL falls back to the default (last 12 months). */
export function filterFromSearchParams(
  params: Record<string, string | string[] | undefined>,
): ReportFilter {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const parsed = reportFilterSchema.safeParse({
    preset: first("preset"),
    dateFrom: first("from"),
    dateTo: first("to"),
  });
  return parsed.success ? parsed.data : DEFAULT_REPORT_FILTER;
}

/** Detail page of a report or KPI, keeping the current range. */
export function reportHref(page: ReportPage, filter: ReportFilter): string {
  return `/reports/${toSlug(page.id)}${filterToQuery(filter)}`;
}
