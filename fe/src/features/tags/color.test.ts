import { describe, expect, it } from "vitest";
import { PRESET_TAG_COLORS } from "./components/color-swatches";
import { readableTextColor, relativeLuminance } from "./color";

// WCAG 2.1 contrast ratio between two `#rrggbb` colours, for the assertions below.
function contrast(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
  });
});

describe("readableTextColor", () => {
  it("picks black text on light backgrounds and white text on dark ones", () => {
    expect(readableTextColor("#ffffff")).toBe("#000000");
    expect(readableTextColor("#facc15")).toBe("#000000");
    expect(readableTextColor("#000000")).toBe("#ffffff");
    expect(readableTextColor("#1e3a8a")).toBe("#ffffff");
  });

  it("reaches WCAG AA contrast (4.5:1) on every preset colour", () => {
    for (const color of PRESET_TAG_COLORS) {
      expect(contrast(color, readableTextColor(color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
