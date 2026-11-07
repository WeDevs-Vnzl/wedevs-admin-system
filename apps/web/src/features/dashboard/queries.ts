import "server-only";
import { fromThrown, toActionResult, type ApiActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type { DashboardResponseDto } from "@/lib/api/types/intel";
import type { DashboardPeriod } from "./period";

// Read for `/dashboard` (RSC). The BE computes the eight cards of the period (`period` = month, quarter or year to
// date), the twelve-month chart and the panels in one call (DT-172, DT-173); money is zeroed by the BE for roles
// without financials (DT-175). The FE only renders what comes back (C16).
export async function getDashboardForPeriod(
  period: DashboardPeriod,
): Promise<ApiActionResult<DashboardResponseDto>> {
  try {
    const api = await getServerApi();
    return toActionResult(await api.GET("/api/v1/dashboard", { params: { query: { period } } }));
  } catch (error) {
    return fromThrown(error);
  }
}
