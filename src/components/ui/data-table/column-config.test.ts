import { describe, expect, it } from "vitest";
import {
  MAX_COLUMN_WIDTH as PREF_MAX,
  MIN_COLUMN_WIDTH as PREF_MIN,
  tableColumnsPreferenceSchema,
} from "@/lib/validators/preferences";
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  columnConfigToPreference,
  defaultColumnConfig,
  moveColumn,
  preferenceToColumnConfig,
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

  it("shares one 80–1200 width range with the stored preference", () => {
    expect([MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH]).toEqual([PREF_MIN, PREF_MAX]);
    expect(setColumnWidth(defaultColumnConfig(descriptors), "code", 5000)[1]?.width).toBe(MAX_COLUMN_WIDTH);
  });

  describe("preference converters", () => {
    const config = [
      { id: "name", visible: false },
      { id: "code", visible: true, width: 200 },
      { id: "select", visible: true },
    ];

    it("round-trips a config through the stored shape", () => {
      const preference = columnConfigToPreference(config);
      expect(tableColumnsPreferenceSchema.safeParse(preference).success).toBe(true);
      expect(preference).toEqual({
        order: ["name", "code", "select"],
        visibility: { name: false, code: true, select: true },
        widths: { code: 200 },
      });
      expect(preferenceToColumnConfig(preference)).toEqual(config);
    });

    it("clamps widths and skips ids the preference schema rejects", () => {
      const preference = columnConfigToPreference([
        { id: "a", visible: true, width: 5000 },
        { id: "1bad", visible: true },
      ]);
      expect(preference.order).toEqual(["a"]);
      expect(preference.widths).toEqual({ a: MAX_COLUMN_WIDTH });
    });

    it("reads ids that only appear in visibility or widths and defaults to visible", () => {
      expect(
        preferenceToColumnConfig({ order: ["a"], visibility: { b: false }, widths: { c: 120 } }),
      ).toEqual([
        { id: "a", visible: true },
        { id: "b", visible: false },
        { id: "c", visible: true, width: 120 },
      ]);
      expect(preferenceToColumnConfig(undefined)).toEqual([]);
    });

    it("feeds resolveColumnConfig, which keeps the definitions as the source of truth", () => {
      const resolved = resolveColumnConfig(
        descriptors,
        preferenceToColumnConfig(columnConfigToPreference(config)),
      );
      expect(resolved.map((c) => c.id)).toEqual(["name", "code", "select", "actions"]);
    });
  });
});
