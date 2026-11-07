import type { ApiClient } from "@/lib/api/client";
import type { ApiResponseLike } from "@/lib/api/errors";
import type {
  ActivityListQuery,
  ActivityListResponseDto,
  ActivityOverviewDto,
} from "@/lib/api/types/activity";
import type { ActivityFilterParams } from "./query-params";

// The two activity reads, one HTTP call each. The BE decides `can()` (Owner and Admin) and answers FORBIDDEN
// otherwise; the callers map that envelope and never decide access here.

/** `GET /api/v1/activity`: one page of the log. */
export async function requestActivityPage(
  api: ApiClient,
  query: ActivityListQuery,
): Promise<ApiResponseLike<ActivityListResponseDto>> {
  const { data, error, response } = await api.GET("/api/v1/activity", { params: { query } });
  // openapi-fetch widens the `changes` tuples of the generated type to arrays; the wire shape is the contract's.
  return { data: data as ActivityListResponseDto | undefined, error, response };
}

/** `GET /api/v1/activity/overview`: the stat figures under the same filter as the table. */
export async function requestActivityOverview(
  api: ApiClient,
  query: ActivityFilterParams,
): Promise<ApiResponseLike<ActivityOverviewDto>> {
  const { data, error, response } = await api.GET("/api/v1/activity/overview", {
    params: { query },
  });
  return { data, error, response };
}
