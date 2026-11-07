import type { ApiClient } from "@/lib/api/client";
import type { ApiResponseLike } from "@/lib/api/errors";
import type { InvitationDto, UserListItemDto } from "@/lib/api/types/identity";
import type { Paginated } from "@/lib/validators/common";
import {
  userFilterSchema,
  type UserFilterInput,
  type UserListRowDTO,
} from "@/lib/validators/users";

// Settings → Usuarios lists users (`GET /users`) with the pending invitations (`GET /users/invitations`)
// merged on top of page 1 under the "Invited" status (BE-1 choice 4). The BE has no status facet and no
// invitation paging, so the invitations are narrowed to the table's role / text / status filters here
// (display only; the BE decides who is allowed to see any of it).

const ok = <T>(data: T): ApiResponseLike<T> => ({
  data,
  response: new Response(null, { status: 200 }),
});

const toActiveRow = (user: UserListItemDto): UserListRowDTO => ({ ...user, status: "ACTIVE" });

const toInvitedRow = (invitation: InvitationDto): UserListRowDTO => ({
  id: invitation.id,
  name: null,
  email: invitation.email,
  imageUrl: null,
  role: invitation.role,
  status: "INVITED",
  createdAt: invitation.createdAt,
});

/** The failing half of a call, typed for the merged result (`data` is absent on a failure). */
const failure = <T>(result: { error?: unknown; response: Response }): ApiResponseLike<T> => ({
  error: result.error,
  response: result.response,
});

export async function listUsersWithInvitations(
  api: ApiClient,
  input: UserFilterInput = {},
): Promise<ApiResponseLike<Paginated<UserListRowDTO>>> {
  const filter = userFilterSchema.parse(input);
  const statuses = filter.status ?? [];
  const wantUsers = statuses.length === 0 || statuses.includes("ACTIVE");
  const wantInvitations = statuses.length === 0 || statuses.includes("INVITED");

  const [users, invitations] = await Promise.all([
    wantUsers
      ? api.GET("/api/v1/users", {
          params: {
            query: {
              page: filter.page,
              pageSize: filter.pageSize as 25 | 50 | 100,
              ...(filter.sort ? { sort: filter.sort as never } : {}),
              ...(filter.q ? { q: filter.q } : {}),
              ...(filter.role?.length ? { role: filter.role } : {}),
            },
          },
        })
      : undefined,
    wantInvitations ? api.GET("/api/v1/users/invitations") : undefined,
  ]);

  if (users && users.data === undefined) return failure(users);
  if (invitations && invitations.data === undefined) return failure(invitations);

  const text = filter.q?.toLowerCase();
  const pending = (invitations?.data?.items ?? [])
    .filter((item) => !filter.role?.length || filter.role.includes(item.role))
    .filter((item) => !text || item.email.toLowerCase().includes(text))
    .map(toInvitedRow);

  const { page, pageSize } = filter;
  const activeRows = users?.data?.items.map(toActiveRow) ?? [];
  // Pending invitations ride on page 1 only: counting them would add an empty extra page. Only an
  // invitations-only filter pages over them.
  const total = wantUsers ? (users?.data?.total ?? 0) : pending.length;
  const items = wantUsers
    ? [...(page === 1 ? pending : []), ...activeRows]
    : pending.slice((page - 1) * pageSize, page * pageSize);

  return ok({ items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) });
}
