import "server-only";
import { getServerApi } from "@/lib/api/server";
import type { ApiResponseLike } from "@/lib/api/errors";
import type { ActivityListResponseDto, ActivityRow } from "@/lib/api/types/activity";
import {
  activityFilterSchema,
  type ActivityFilter,
  type ActivityFilterInput,
} from "@/lib/validators/activity";
import type { Paginated } from "@/lib/validators/common";
import type { EntityType } from "@/lib/validators/enums";
import { can } from "@/server/auth/permissions";
import { getSessionUser } from "@/server/auth/session";
import { requestActivityOverview, requestActivityPage } from "./api";
import { activityListQuery, activityOverviewQuery } from "./query-params";

/** Filter keys the `/activity` URL carries (nuqs). Anything else in the URL is ignored. */
const URL_FILTER_KEYS = ["actorId", "actorType", "action", "entityType", "from", "to"] as const;

/** Reads the filter from the page's search params; an invalid URL falls back to the unfiltered log. */
export function activityFilterFromSearchParams(
  params: Record<string, string | string[] | undefined>,
): ActivityFilterInput {
  const raw = Object.fromEntries(
    URL_FILTER_KEYS.flatMap((key) => (params[key] === undefined ? [] : [[key, params[key]]])),
  );
  const parsed = activityFilterSchema.safeParse(raw);
  return parsed.success ? (raw as ActivityFilterInput) : {};
}

export interface ActivityPageData {
  filter: ActivityFilter;
  feed: Paginated<ActivityRow>;
  /** Stat cards: matching events, today's events (Caracas) and matching actions of users (BE overview). */
  stats: { total: number; today: number; users: number };
  /** The users that appear in the log, for the user filter (from the most recent user entries). */
  actors: { id: string; name: string }[];
}

/**
 * A read result, or `null` when the BE refuses the caller (`403 FORBIDDEN`: no access to the log, C13).
 * Any other failure throws, so the route's error boundary shows it.
 */
function readOrNull<T>(result: ApiResponseLike<T>, what: string): T | null {
  if (result.response.status === 403) return null;
  if (result.error !== undefined || !result.response.ok || result.data === undefined) {
    throw new Error(`activity: ${what} failed with ${result.response.status}`);
  }
  return result.data;
}

/** `/activity`: the filtered timeline, the stat cards and the user options. `null` without access (BE 403). */
export async function getActivityPage(
  input: ActivityFilterInput,
): Promise<ActivityPageData | null> {
  const filter = activityFilterSchema.parse({ ...input, page: 1, pageSize: 25 });
  const api = await getServerApi();
  const [feedResult, overviewResult, recentResult] = await Promise.all([
    requestActivityPage(api, activityListQuery(filter)),
    requestActivityOverview(api, activityOverviewQuery(filter)),
    requestActivityPage(api, { actorType: ["USER"], pageSize: 100, page: 1 }),
  ]);
  const feed = readOrNull(feedResult, "feed");
  const figures = readOrNull(overviewResult, "overview");
  const recent = readOrNull(recentResult, "actors");
  if (!feed || !figures || !recent) return null;

  const actors = new Map<string, string>();
  for (const row of recent.items) {
    if (row.actor.id && row.actor.name) actors.set(row.actor.id, row.actor.name);
  }

  return {
    filter,
    feed,
    stats: { total: figures.total, today: figures.today, users: figures.users },
    actors: [...actors]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Whether the signed-in user may read the activity log, for showing the entity *Actividad* tab and the
 * activity link. Cosmetic: the BE `can()` decides every read (a refused read answers `403`).
 */
export async function canReadActivity(): Promise<boolean> {
  return can(await getSessionUser(), "read", "activity");
}

/** The timeline of one record (its *Actividad* tab). `null` without access (BE 403). */
export async function getEntityActivity(entity: {
  type: EntityType;
  id: string;
}): Promise<Paginated<ActivityRow> | null> {
  const api = await getServerApi();
  const result = await requestActivityPage(api, {
    entityType: [entity.type],
    entityId: entity.id,
    page: 1,
    pageSize: 25,
  });
  return readOrNull<ActivityListResponseDto>(result, "entity timeline");
}
