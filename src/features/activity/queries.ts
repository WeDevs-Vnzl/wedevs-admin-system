import "server-only";
import { todayInCaracas } from "@/lib/dates";
import {
  activityFilterSchema,
  type ActivityFilter,
  type ActivityFilterInput,
  type ActivityListRowDTO,
} from "@/lib/validators/activity";
import type { Paginated } from "@/lib/validators/common";
import type { EntityType } from "@/lib/validators/enums";
import * as activity from "@/mocks/services/activity";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/context";

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
  feed: Paginated<ActivityListRowDTO>;
  /** Stat cards: matching events, today's events (Caracas) and matching actions of users. */
  stats: { total: number; today: number; users: number };
  /** The users that appear in the log, for the user filter (from the most recent user entries). */
  actors: { id: string; name: string }[];
}

/** `/activity`: the filtered timeline, the stat cards and the user options. `null` without `read` (C13). */
export async function getActivityPage(
  input: ActivityFilterInput,
): Promise<ActivityPageData | null> {
  const ctx = await getServiceContext();
  if (!can(ctx.user, "read", "activity")) return null;

  const filter = activityFilterSchema.parse({ ...input, page: 1, pageSize: 25 });
  const today = todayInCaracas(ctx.now);
  const [feed, todayFeed, userFeed, recent] = await Promise.all([
    activity.listActivity(ctx, filter),
    activity.listActivity(ctx, activityFilterSchema.parse({ from: today, to: today })),
    activity.listActivity(ctx, activityFilterSchema.parse({ ...filter, actorType: ["USER"] })),
    activity.listActivity(ctx, activityFilterSchema.parse({ actorType: ["USER"], pageSize: 100 })),
  ]);

  const actors = new Map<string, string>();
  for (const row of recent.items) {
    if (row.actor.id && row.actor.name) actors.set(row.actor.id, row.actor.name);
  }

  return {
    filter,
    feed,
    stats: { total: feed.total, today: todayFeed.total, users: userFeed.total },
    actors: [...actors]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Whether the signed-in user may read the activity log (the entity *Actividad* tab checks it too). */
export async function canReadActivity(): Promise<boolean> {
  const ctx = await getServiceContext();
  return can(ctx.user, "read", "activity");
}

/** The timeline of one record (its *Actividad* tab). `null` without `read` on activity. */
export async function getEntityActivity(entity: {
  type: EntityType;
  id: string;
}): Promise<Paginated<ActivityListRowDTO> | null> {
  const ctx = await getServiceContext();
  if (!can(ctx.user, "read", "activity")) return null;
  return activity.listActivity(
    ctx,
    activityFilterSchema.parse({ entityType: [entity.type], entityId: entity.id, pageSize: 25 }),
  );
}
