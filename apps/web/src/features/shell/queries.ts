import "server-only";
import { getServerApi } from "@/lib/api/server";
import type { ShellResponseDto } from "@/lib/api/types/shell";
import type { DateOnly } from "@/lib/dates";
import { RATE_SOURCE_VALUES, type RateSource } from "@/lib/validators/enums";
import { getSessionUserOrRedirect, UnauthenticatedError } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/types";

/** The BCV chip of the topbar: the latest VES rate and the date it comes from (PRD §9.2). */
export interface ShellVesRate {
  /** Date of the rate shown (earlier than today when today has none yet). */
  date: DateOnly;
  /** The decimal string as the BE returned it; the chip formats it for display only (C15). */
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
  /** The current user's active alerts (`alerts.total`: after dismissals, snoozes and role filtering). */
  alertCount: number;
  /** The bell counter (`alerts.unread`): active alerts the user has not marked read. */
  unreadAlertCount: number;
}

/** A rate source the frontend does not know (the contract types it as a plain string) reads as no source. */
function rateSourceOf(value: string | null): RateSource | null {
  return RATE_SOURCE_VALUES.find((source) => source === value) ?? null;
}

/** Maps `GET /api/v1/shell` and the session user onto the shell's shape. Pure. */
export function toShellData(user: SessionUser, dto: ShellResponseDto): ShellData {
  const rate = dto.vesRate;
  return {
    user,
    vesRate: rate
      ? { date: rate.date, usdRate: rate.usdRate, source: rateSourceOf(rate.source) }
      : null,
    vesRateMissing: dto.vesRateMissing,
    alertCount: dto.alerts.total,
    unreadAlertCount: dto.alerts.unread,
  };
}

/**
 * The shell data of the current request (`GET /api/v1/shell`). The shell user comes from the session seam
 * (`GET /api/v1/me`, memoized per request): the shell response carries no avatar, locale or theme.
 */
export async function getShellData(): Promise<ShellData> {
  const user = await getSessionUserOrRedirect();
  if (!user) throw new UnauthenticatedError();
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/shell");
  if (!data) throw new Error(`GET /api/v1/shell failed with ${response.status}`);
  return toShellData(user, data);
}
