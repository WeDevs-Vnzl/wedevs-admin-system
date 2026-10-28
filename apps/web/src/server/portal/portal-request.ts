import "server-only";
import { cookies, headers } from "next/headers";
import type { PortalRequestMeta } from "@/lib/validators/shares";
import { clientIpOf, hashIp, portalSecret, userAgentOf } from "./request-meta";
import {
  UNLOCK_COOKIE_NAMES,
  signUnlockCookie,
  unlockCookieOptions,
  verifyUnlockCookie,
  type UnlockCookieScope,
} from "./unlock-cookie";

/** The server-only metadata of a portal request (C22): what services get besides the visitor's own fields. */
export interface PortalRequest extends PortalRequestMeta {
  /** Key-protected documents this visitor already unlocked, from the signed cookie. */
  unlockedDocumentIds: string[];
}

/**
 * Reads the request metadata of a portal call for `token`: the salted IP hash, the user agent and the unlocked ids
 * of the cookie of `scope` (`page` for the page and its Server Actions, `api` for the download route).
 */
export async function getPortalRequest(
  token: string,
  scope: UnlockCookieScope = "page",
): Promise<PortalRequest> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  const userAgent = userAgentOf(headerList);
  return {
    ipHash: hashIp(clientIpOf(headerList), portalSecret("SHARE_IP_SALT")),
    ...(userAgent ? { userAgent } : {}),
    unlockedDocumentIds: verifyUnlockCookie(
      cookieStore.get(UNLOCK_COOKIE_NAMES[scope])?.value,
      token,
      new Date(),
      portalSecret("SHARE_UNLOCK_SECRET"),
    ),
  };
}

/**
 * Remembers `documentId` as unlocked for the rest of the visit: rewrites both cookies (page and download route)
 * with the ids already unlocked plus this one. Only a Server Action or a route handler may call it.
 */
export async function rememberUnlockedDocument(
  token: string,
  unlockedDocumentIds: readonly string[],
  documentId: string,
): Promise<void> {
  const cookieStore = await cookies();
  const value = signUnlockCookie(
    { token, documentIds: [...unlockedDocumentIds, documentId], now: new Date() },
    portalSecret("SHARE_UNLOCK_SECRET"),
  );
  for (const scope of ["page", "api"] as const) {
    cookieStore.set(UNLOCK_COOKIE_NAMES[scope], value, unlockCookieOptions(token, scope));
  }
}
