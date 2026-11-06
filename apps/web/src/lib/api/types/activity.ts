import type { components, operations } from "../schema";

// Generated activity DTOs re-exported for code outside `src/lib/api/**` (C8): the activity feature picks from
// these types and never redefines the response shapes.

/** `GET /api/v1/activity`: one page of the log, newest first, with the IP as the BE returns it. */
export type ActivityListResponseDto = components["schemas"]["ActivityListResponseDto"];

/** `GET /api/v1/activity/overview`: the stat figures under the table filter. */
export type ActivityOverviewDto = components["schemas"]["ActivityOverviewDto"];

/** Query parameters of `GET /api/v1/activity` (the overview takes the same filter keys). */
export type ActivityListQuery = NonNullable<operations["listActivity"]["parameters"]["query"]>;
