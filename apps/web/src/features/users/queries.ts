import "server-only";
import { userFilterSchema, type UserFilterInput } from "@/lib/validators/users";
import * as users from "@/mocks/services/users";
import { getServiceContext } from "@/server/context";

/** First page of Settings → Usuarios (users and pending invitations) for the query in the URL. */
export async function getUsers(filter: UserFilterInput = {}) {
  return users.listUsers(await getServiceContext(), userFilterSchema.parse(filter));
}
