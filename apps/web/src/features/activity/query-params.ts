import type { ActivityListQuery } from "@/lib/api/types/activity";
import type { ActivityFilter } from "@/lib/validators/activity";

// Pure mapping of the activity filter onto the query of `GET /api/v1/activity` (and its overview). Flat
// filters; arrays go out as repeated keys through `openapi-fetch`. No business rule: the BE re-validates.

/** The filter keys shared by the list and the overview (no paging, no sort). */
export type ActivityFilterParams = Pick<
  ActivityListQuery,
  "q" | "actorId" | "actorType" | "action" | "entityType" | "entityId" | "from" | "to"
>;

/** The facets and the date range of a filter, only the ones that are set. */
export function activityFilterParams(filter: ActivityFilter): ActivityFilterParams {
  const params: ActivityFilterParams = {};
  if (filter.q !== undefined) params.q = filter.q;
  if (filter.actorId?.length) params.actorId = filter.actorId;
  if (filter.actorType?.length) params.actorType = filter.actorType;
  if (filter.action?.length) params.action = filter.action;
  if (filter.entityType?.length) params.entityType = filter.entityType;
  if (filter.entityId !== undefined) params.entityId = filter.entityId;
  if (filter.from !== undefined) params.from = filter.from;
  if (filter.to !== undefined) params.to = filter.to;
  return params;
}

/** The `GET /api/v1/activity` query of one page of a filter. */
export function activityListQuery(filter: ActivityFilter): ActivityListQuery {
  return {
    ...activityFilterParams(filter),
    page: filter.page,
    pageSize: filter.pageSize,
    // The BE whitelists the sort fields and answers 422 otherwise; the table drops such a sort.
    ...(filter.sort !== undefined && { sort: filter.sort as ActivityListQuery["sort"] }),
  };
}

/** The `GET /api/v1/activity/overview` query: the table filter, so the figures count the same rows. */
export function activityOverviewQuery(filter: ActivityFilter): ActivityFilterParams {
  return activityFilterParams(filter);
}
