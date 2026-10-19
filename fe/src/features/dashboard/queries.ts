import "server-only";
import {
  dashboardQuerySchema,
  type DashboardDTO,
  type KpiCardDTO,
} from "@/lib/validators/dashboard";
import * as dashboard from "@/mocks/services/dashboard";
import { getServiceContext } from "@/server/context";
import { aggregatePeriodKpis, periodMonths, type DashboardPeriod } from "./period";

export type DashboardPageData = {
  /** The current month's dashboard: panels, chart and the month cards. */
  dashboard: DashboardDTO;
  /** The eight cards over the selected period. */
  kpis: KpiCardDTO[];
};

// Read for `/dashboard` (RSC). The service answers one month; a quarter or a year to date reads each of its months
// and the same months of the previous period, then aggregates the cards (`aggregatePeriodKpis`).
export async function getDashboardForPeriod(period: DashboardPeriod): Promise<DashboardPageData> {
  const ctx = await getServiceContext();
  const current = await dashboard.getDashboard(ctx, dashboardQuerySchema.parse({}));
  if (period === "month") return { dashboard: current, kpis: current.kpis };

  const { months, previousMonths } = periodMonths(current.month, period);
  const read = (month: string) =>
    month === current.month
      ? Promise.resolve(current)
      : dashboard.getDashboard(ctx, dashboardQuerySchema.parse({ month }));
  const [inPeriod, before] = await Promise.all([
    Promise.all(months.map(read)),
    Promise.all(previousMonths.map(read)),
  ]);
  return {
    dashboard: current,
    kpis: aggregatePeriodKpis(
      inPeriod.map((item) => item.kpis),
      before.map((item) => item.kpis),
    ),
  };
}
