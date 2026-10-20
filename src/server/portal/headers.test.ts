import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("portal headers in next.config (PRD §8.11, C22)", () => {
  it("sends noindex, no-referrer and no-store on every /s/* and /api/s/* response", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    for (const source of ["/s/:path*", "/api/s/:path*"]) {
      expect(rules.find((rule) => rule.source === source)?.headers).toEqual([
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
      ]);
    }
  });

  it("leaves the back office alone", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.map((rule) => rule.source)).toEqual(["/s/:path*", "/api/s/:path*"]);
  });
});
