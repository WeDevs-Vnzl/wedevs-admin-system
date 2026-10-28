import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { idSchema } from "@/lib/validators/common";
import { z } from "@/lib/validators/zod";

// The portal's unlock cookie (DT-45, C22): which key-protected documents of one link this visitor already unlocked.
// Signed with HMAC-SHA256 (`SHARE_UNLOCK_SECRET`), httpOnly, Secure, SameSite=Strict, scoped to the token paths and
// valid for 12 h at most. It names the link by a hash of its token, never the token itself. Framework-free;
// `portal-request.ts` reads and writes it through `next/headers`.

export const UNLOCK_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
/** One cookie per path: the page (and its Server Actions) and the download route. */
export const UNLOCK_COOKIE_NAMES = {
  page: "wd_portal_unlock",
  api: "wd_portal_unlock_api",
} as const;
export type UnlockCookieScope = keyof typeof UNLOCK_COOKIE_NAMES;

const MAX_IDS = 50;

const payloadSchema = z.object({
  /** SHA-256 of the share token, base64url. */
  l: z.string(),
  ids: z.array(idSchema).max(MAX_IDS),
  /** Expiry, epoch milliseconds. */
  exp: z.number().int(),
});

function linkIdOf(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** A signed cookie value listing `documentIds` as unlocked for the link of `token`, valid 12 h from `now`. */
export function signUnlockCookie(
  input: { token: string; documentIds: readonly string[]; now: Date },
  secret: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      l: linkIdOf(input.token),
      ids: [...new Set(input.documentIds)].slice(0, MAX_IDS),
      exp: input.now.getTime() + UNLOCK_COOKIE_MAX_AGE_SECONDS * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

/**
 * The unlocked ids of a cookie value, or `[]` when it is missing, malformed, forged, expired or for another link.
 * The signature is compared in constant time.
 */
export function verifyUnlockCookie(
  value: string | undefined,
  token: string,
  now: Date,
  secret: string,
): string[] {
  if (!value) return [];
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return [];
  const expected = sign(payload, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return [];
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) return [];
  if (parsed.data.l !== linkIdOf(token) || parsed.data.exp < now.getTime()) return [];
  return parsed.data.ids;
}

export function unlockCookieOptions(token: string, scope: UnlockCookieScope) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: scope === "page" ? `/s/${token}` : `/api/s/${token}`,
    maxAge: UNLOCK_COOKIE_MAX_AGE_SECONDS,
  };
}
