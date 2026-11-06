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
  it("is exactly sign-in plus the portal page (F5), with no FE file route", () => {
    expect(PUBLIC_ROUTE_PATTERNS).toEqual(["/sign-in(.*)", "/s/([^/]+)"]);
  });

  it.each(["/sign-in", "/sign-in/factor-one", "/s/abc123"])("%s is public", (path) =>
    expect(isPublicRoute(req(path))).toBe(true),
  );

  it.each(["/", "/dashboard", "/clients/1", "/api/v1/me", "/api/webhooks/clerk", "/settings"])(
    "%s is protected",
    (path) => expect(isPublicRoute(req(path))).toBe(false),
  );

  // Unknown paths under the portal prefixes fall into the shell's catch-all (`(app)/[...missing]`), which needs a
  // session: they must be protected (sign-in redirect), never public (a 500 from the shell without a user, F5).
  it.each([
    "/s/a/b/c",
    "/s/abc123/extra",
    "/s/abc123/x",
    "/api/s/x",
    "/api/s/abc123/files/doc-1",
    "/api/s/abc123/download",
    "/api/s/a/files/b/c",
    "/some/unknown/path",
  ])("unknown portal path %s is protected", (path) => expect(isPublicRoute(req(path))).toBe(false));

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

  it("sends the portal headers on the portal page and its 404 only", async () => {
    const rules = await nextConfig.headers!();
    const portal = rules.filter((r) => r.source !== "/:path*");
    expect(portal.map((r) => r.source)).toEqual(["/s/:path*"]);
    expect(Object.fromEntries(portal[0]!.headers.map((h) => [h.key, h.value]))).toEqual({
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
    });
  });

  it("lets the browser reach the API origin for portal calls and file links", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test/");
    const { CONTENT_SECURITY_POLICY } = await import("../next.config");
    const directive = (name: string) =>
      CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("connect-src")).toContain("https://api.example.test");
    expect(directive("img-src")).toContain("https://api.example.test");
    vi.unstubAllEnvs();
  });
});
