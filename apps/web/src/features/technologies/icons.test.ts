import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveTechnologyIcon } from "./icons";

describe("resolveTechnologyIcon (server only)", () => {
  it("resolves a Simple Icons slug to its path and brand colour", () => {
    const icon = resolveTechnologyIcon("nextdotjs");
    expect(icon).not.toBeNull();
    expect(icon!.title).toBe("Next.js");
    expect(icon!.path.length).toBeGreaterThan(0);
    expect(icon!.hex).toMatch(/^[0-9A-Fa-f]{6}$/);
  });

  it("returns null for an unknown slug and for no slug", () => {
    expect(resolveTechnologyIcon("no-such-brand-xyz")).toBeNull();
    expect(resolveTechnologyIcon(null)).toBeNull();
  });
});
