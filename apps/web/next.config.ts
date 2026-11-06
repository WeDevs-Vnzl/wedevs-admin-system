import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Strict CSP (C24, PRD §14). Next needs inline scripts/styles without a nonce pipeline; Clerk, the BE origin and
// Cloudinary are the only external origins. `worker-src blob:` serves pdf.js and the graph worker.
const apiOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_API_BASE_URL
      ? new URL(process.env.NEXT_PUBLIC_API_BASE_URL).origin
      : "";
  } catch {
    return "";
  }
})();

// Response headers of the public portal page and its generic 404 (PRD §8.11 "Cabeceras", C22).
const PORTAL_SECURITY_HEADERS = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "private, no-store" },
];

const clerkOrigins = "https://*.clerk.accounts.dev https://*.clerk.com";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} ${clerkOrigins} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  // The portal image preview points at the API file route (302 to the signed Cloudinary URL).
  `img-src 'self' data: blob: ${apiOrigin} https://img.clerk.com https://res.cloudinary.com`,
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} ${clerkOrigins} https://api.cloudinary.com https://res.cloudinary.com`,
  `frame-src ${clerkOrigins} https://challenges.cloudflare.com`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]
  .map((directive) => directive.replace(/\s+/g, " ").trim())
  .join("; ");

export const APP_SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server for apps/web/Dockerfile; the tracing root is inferred from the monorepo bun.lock.
  output: "standalone",
  // Public portal (PRD §8.11, C22): never indexed, never cached, no referrer — the generic 404 included.
  async headers() {
    return [
      { source: "/:path*", headers: APP_SECURITY_HEADERS },
      { source: "/s/:path*", headers: PORTAL_SECURITY_HEADERS },
    ];
  },
};

export default withNextIntl(nextConfig);
