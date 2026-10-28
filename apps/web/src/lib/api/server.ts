import "server-only";
import { auth } from "@clerk/nextjs/server";
import { cache } from "react";
import { createApiClient, type ApiClient } from "./client";

/**
 * Server-side client (server components, route handlers, Server Actions): the Clerk session token comes
 * from `auth().getToken()`. Memoized per request with React `cache`, so one request builds one client.
 */
export const getServerApi: () => Promise<ApiClient> = cache(async () => {
  const session = await auth();
  return createApiClient({ getToken: () => session.getToken() });
});
