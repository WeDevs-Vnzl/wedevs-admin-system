import { createHash } from "node:crypto";

// Request metadata of the public portal (C20, C22): the salted IP hash the access log and the unlock lockout are
// keyed on, and the portal secrets. Framework-free so it is testable without a request; `portal-request.ts` reads
// the headers and cookies.

/** Secrets of the portal (`.env.example`); only the server reads them. */
export type PortalSecretName = "SHARE_IP_SALT" | "SHARE_UNLOCK_SECRET";

/**
 * The configured secret. Production refuses to run without it; development and tests fall back to a fixed,
 * clearly named value so the mock portal works out of the box.
 */
export function portalSecret(name: PortalSecretName): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} is not configured`);
  return `dev-only-${name.toLowerCase()}`;
}

/** Salted SHA-256 of the visitor IP in lowercase hex (`ipHashSchema`). The raw IP never leaves this function. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * The visitor IP: Netlify's client header first, then the first `X-Forwarded-For` hop, then `X-Real-IP`.
 * `"unknown"` when none is present (local development), so every such visitor shares one lockout bucket.
 */
export function clientIpOf(headers: Headers): string {
  const platform = headers.get("x-nf-client-connection-ip")?.trim();
  if (platform) return platform;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** User agent as stored in the access log (`requestMetaShape` caps it at 512). */
export function userAgentOf(headers: Headers): string | undefined {
  return headers.get("user-agent")?.slice(0, 512) || undefined;
}
