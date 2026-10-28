import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (patterns: string[]) => {
    const regexes = patterns.map((p) => new RegExp(`^${p}$`));
    return (req: { nextUrl: { pathname: string } }) =>
      regexes.some((r) => r.test(req.nextUrl.pathname));
  },
}));

import nextConfig from "../next.config";
import { PUBLIC_ROUTE_PATTERNS, config, isPublicRoute } from "./proxy";

const req = (pathname: string) => ({ nextUrl: { pathname } }) as never;

describe("proxy public routes", () => {
  it("is exactly the DT-42 set without the obsolete webhooks route", () => {
    expect(PUBLIC_ROUTE_PATTERNS).toEqual(["/sign-in(.*)", "/s/(.*)", "/api/s/(.*)"]);
  });

  it.each(["/sign-in", "/sign-in/factor-one", "/s/abc123", "/api/s/abc123/download"])(
    "%s is public",
    (path) => expect(isPublicRoute(req(path))).toBe(true),
  );

  it.each(["/", "/dashboard", "/clients/1", "/api/v1/me", "/api/webhooks/clerk", "/settings"])(
    "%s is protected",
    (path) => expect(isPublicRoute(req(path))).toBe(false),
  );

  it("skips static assets and Next internals in the matcher", () => {
    const pages = new RegExp(`^${config.matcher[0]}$`);
    expect(pages.test("/dashboard")).toBe(true);
    expect(pages.test("/_next/static/chunk.js")).toBe(false);
    expect(pages.test("/logo.png")).toBe(false);
  });
});

describe("security headers", () => {
  it("applies CSP, HSTS, nosniff and frame-ancestors none to every route", async () => {
    const rules = await nextConfig.headers!();
    const app = rules.find((r) => r.source === "/:path*")!;
    const get = (k: string) => app.headers.find((h) => h.key === k)?.value ?? "";
    expect(get("Strict-Transport-Security")).toContain("max-age=");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    const csp = get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("https://api.cloudinary.com");
    expect(csp).toContain("https://res.cloudinary.com");
    expect(csp).toContain("clerk");
  });

  it("keeps the portal headers on the portal sources", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.some((r) => r.source === "/s/:path*")).toBe(true);
  });
});
