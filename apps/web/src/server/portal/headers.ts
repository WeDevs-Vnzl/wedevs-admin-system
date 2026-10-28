// Response headers of every portal response (`/s/*`, `/api/s/*`; PRD §8.11 "Cabeceras", C22). Framework-free so
// `next.config.ts` (pages, including the generic 404) and the download route share one list.
export const PORTAL_SECURITY_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
} as const;

/** Path patterns of `next.config.ts` `headers()` the portal headers apply to. */
export const PORTAL_HEADER_SOURCES = ["/s/:path*", "/api/s/:path*"] as const;
