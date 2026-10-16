import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { PORTAL_HEADER_SOURCES, PORTAL_SECURITY_HEADERS } from "./src/server/portal/headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Public portal (PRD §8.11, C22): never indexed, never cached, no referrer — the generic 404 included.
  async headers() {
    const headers = Object.entries(PORTAL_SECURITY_HEADERS).map(([key, value]) => ({ key, value }));
    return PORTAL_HEADER_SOURCES.map((source) => ({ source, headers }));
  },
};

export default withNextIntl(nextConfig);
