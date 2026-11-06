import "server-only";
import { redirect } from "next/navigation";
import { SIGN_IN_PATH } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type { ApiTokenListItem } from "@/lib/api/types/api-tokens";
import { listApiTokens } from "./api";

/**
 * The signed-in user's own personal access tokens, newest first (`GET /me/api-tokens`). Every role has them,
 * so there is no permission check here; the BE returns only the caller's rows.
 */
export async function getApiTokens(): Promise<ApiTokenListItem[]> {
  const result = await listApiTokens(await getServerApi());
  if (result.ok) return result.data;
  if (result.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  throw new Error(`Could not load the API tokens (${result.error.code})`);
}
