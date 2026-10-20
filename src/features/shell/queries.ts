import "server-only";
import { isBusinessDay, todayInCaracas, type DateOnly } from "@/lib/dates";
import type { RateSource } from "@/lib/validators/enums";
import { listAlerts } from "@/mocks/services/alerts";
import { getRateFor } from "@/mocks/services/catalogs";
import type { SessionUser } from "@/server/auth/types";
import { getServiceContext } from "@/server/context";

/** The BCV chip of the topbar: the latest VES rate and the date it comes from (PRD §9.2). */
export interface ShellVesRate {
  /** Date of the rate shown (earlier than today when today has none yet). */
  date: DateOnly;
  usdRate: string;
  source: RateSource | null;
}

/**
 * What the application shell (sidebar, topbar, user menu, footer) needs on every page. The shell has no
 * contract in `src/lib/validators`: this is its single reader, so the shape lives here.
 */
export interface ShellData {
  user: SessionUser;
  vesRate: ShellVesRate | null;
  /** True when a business day has no VES rate yet (or there is none at all): the chip shows a warning. */
  vesRateMissing: boolean;
  /** Bell counter: the current user's active alerts (after dismissals, snoozes and role filtering). */
  alertCount: number;
}

export async function getShellData(): Promise<ShellData> {
  const ctx = await getServiceContext();
  const today = todayInCaracas(ctx.now);
  const rate = await getRateFor(ctx, { date: today, currency: "VES" });
  return {
    user: ctx.user,
    vesRate: rate ? { date: rate.effectiveDate, usdRate: rate.usdRate, source: rate.source } : null,
    // A weekend has no rate by design; only a business day without one is a gap.
    vesRateMissing: rate === null || (rate.isFallback && isBusinessDay(today)),
    alertCount: (await listAlerts(ctx, { limit: 1 })).total,
  };
}
