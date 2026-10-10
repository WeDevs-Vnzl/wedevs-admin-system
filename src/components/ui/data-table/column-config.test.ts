import { describe, expect, it } from "vitest";
import {
  MIN_COLUMN_WIDTH,
  defaultColumnConfig,
  moveColumn,
  resolveColumnConfig,
  setColumnVisible,
  setColumnWidth,
  visibleColumnIds,
} from "./column-config";

const descriptors = [
  { id: "select", hideable: false },
  { id: "code", hideable: true },
  { id: "name", hideable: true },
  { id: "actions", hideable: false },
];

describe("column config", () => {
  it("defaults to every column visible, in definition order", () => {
    expect(defaultColumnConfig(descriptors).map((c) => c.id)).toEqual(["select", "code", "name", "actions"]);
    expect(visibleColumnIds(defaultColumnConfig(descriptors))).toHaveLength(4);
  });

  it("keeps the saved order and visibility, drops unknown ids and appends new columns", () => {
    const resolved = resolveColumnConfig(descriptors, [
      { id: "name", visible: false },
      { id: "gone", visible: true },
      { id: "code", visible: true, width: 200 },
    ]);

    expect(resolved).toEqual([
      { id: "name", visible: false },
      { id: "code", visible: true, width: 200 },
      { id: "select", visible: true },
      { id: "actions", visible: true },
    ]);
  });

  it("never hides a non-hideable column, even when the saved state says so", () => {
    const resolved = resolveColumnConfig(descriptors, [{ id: "select", visible: false }]);
    expect(resolved.find((c) => c.id === "select")?.visible).toBe(true);
  });

  it("clamps widths to the minimum", () => {
    const resolved = resolveColumnConfig(descriptors, [{ id: "code", visible: true, width: 10 }]);
    expect(resolved.find((c) => c.id === "code")?.width).toBe(MIN_COLUMN_WIDTH);
    expect(setColumnWidth(resolved, "code", 5).find((c) => c.id === "code")?.width).toBe(MIN_COLUMN_WIDTH);
  });

  it("moves a column up or down and ignores moves past the edges", () => {
    const config = defaultColumnConfig(descriptors);
    expect(moveColumn(config, "name", -1).map((c) => c.id)).toEqual(["select", "name", "code", "actions"]);
    expect(moveColumn(config, "name", 1).map((c) => c.id)).toEqual(["select", "code", "actions", "name"]);
    expect(moveColumn(config, "select", -1)).toBe(config);
    expect(moveColumn(config, "actions", 1)).toBe(config);
    expect(moveColumn(config, "unknown", 1)).toBe(config);
  });

  it("toggles visibility for one column and reports the visible ids in order", () => {
    const config = setColumnVisible(defaultColumnConfig(descriptors), "code", false);
    expect(visibleColumnIds(config)).toEqual(["select", "name", "actions"]);
  });
});
