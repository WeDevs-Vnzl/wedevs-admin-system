import "server-only";
import { unwrapOrBoundary } from "@/features/settings/query-boundary";
import { toActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type { UserFilterInput } from "@/lib/validators/users";
import { listUsersWithInvitations } from "./list-users";

/**
 * First page of Settings → Usuarios (users with the pending invitations on top) for the query in the URL.
 * `FORBIDDEN` (not an Owner) is the in-shell not-found page.
 */
export async function getUsers(filter: UserFilterInput = {}) {
  const api = await getServerApi();
  return unwrapOrBoundary(toActionResult(await listUsersWithInvitations(api, filter)));
}
