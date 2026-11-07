// Period selector of the dashboard (frontend-patterns §9: Mes / Trimestre / Año). The period lives in the URL
// (`?period=`) and goes to the BE as `period`; the BE aggregates the cards over it (DT-172). Pure, so the page and
// the tests share the parsing.

export const DASHBOARD_PERIOD_VALUES = ["month", "quarter", "year"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIOD_VALUES)[number];

/** The `?period=` search param, `month` when missing or unknown. */
export function parseDashboardPeriod(value: string | string[] | undefined): DashboardPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_PERIOD_VALUES.find((period) => period === raw) ?? "month";
}
