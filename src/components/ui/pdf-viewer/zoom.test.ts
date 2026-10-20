import { describe, expect, it } from "vitest";
import {
  canGoNext,
  canGoPrevious,
  canZoomIn,
  canZoomOut,
  clampPage,
  MAX_ZOOM,
  MIN_ZOOM,
  zoomIn,
  zoomOut,
  zoomPercent,
} from "./zoom";

describe("clampPage", () => {
  it("keeps the page inside 1..pageCount", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(9, 5)).toBe(5);
  });

  it("stays on page 1 while the document has no pages loaded", () => {
    expect(clampPage(4, 0)).toBe(1);
  });
});

describe("page bounds", () => {
  it("disables previous on the first page and next on the last", () => {
    expect(canGoPrevious(1)).toBe(false);
    expect(canGoPrevious(2)).toBe(true);
    expect(canGoNext(4, 4)).toBe(false);
    expect(canGoNext(3, 4)).toBe(true);
  });
});

describe("zoom steps", () => {
  it("steps up and down through the fixed list", () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomIn(0.75)).toBe(1);
    expect(zoomOut(1.25)).toBe(1);
  });

  it("stops at the minimum and maximum zoom", () => {
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(canZoomIn(MAX_ZOOM)).toBe(false);
    expect(canZoomOut(MIN_ZOOM)).toBe(false);
    expect(canZoomIn(MIN_ZOOM)).toBe(true);
    expect(canZoomOut(MAX_ZOOM)).toBe(true);
  });

  it("formats the zoom as a whole percentage", () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(0.75)).toBe(75);
    expect(zoomPercent(1.25)).toBe(125);
  });
});
