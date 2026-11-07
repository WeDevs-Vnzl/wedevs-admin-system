import { afterEach, describe, expect, it, vi } from "vitest";
import { cameraDuration, prefersReducedMotion } from "./motion";

// better-ui: camera motion of the canvas is gated behind the reduced-motion preference (it is removed for users who
// ask for less motion, kept for everyone else). The preference is read when the animation starts.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cameraDuration", () => {
  it("keeps the animation for users without a reduced-motion preference", () => {
    expect(cameraDuration(300, false)).toBe(300);
  });

  it("removes the animation (0 ms) when the user asks for reduced motion", () => {
    expect(cameraDuration(300, true)).toBe(0);
  });
});

describe("prefersReducedMotion", () => {
  it("reads the reduce media query of the window", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    vi.stubGlobal("window", { matchMedia });

    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("is false when the user has no preference", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false where there is no window to ask (server render, tests without matchMedia)", () => {
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal("window", {});
    expect(prefersReducedMotion()).toBe(false);
  });
});
