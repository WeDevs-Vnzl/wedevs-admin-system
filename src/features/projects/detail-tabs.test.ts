import { describe, expect, it } from "vitest";
import {
  PROJECT_DETAIL_TAB_VALUES,
  parseProjectDetailTab,
  projectDetailTabHref,
} from "./detail-tabs";

describe("project detail tabs", () => {
  it("lists the English tab values in display order", () => {
    expect(PROJECT_DETAIL_TAB_VALUES).toEqual([
      "summary",
      "links",
      "billing",
      "invoices",
      "expenses",
      "documents",
      "notes",
      "activity",
    ]);
  });

  it("accepts known values and falls back to summary for anything else", () => {
    expect(parseProjectDetailTab("links")).toBe("links");
    expect(parseProjectDetailTab("enlaces")).toBe("summary");
    expect(parseProjectDetailTab(undefined)).toBe("summary");
    expect(parseProjectDetailTab(["links"])).toBe("summary");
  });

  it("builds the tab URL", () => {
    expect(projectDetailTabHref("pry_1", "summary")).toBe("/projects/pry_1");
    expect(projectDetailTabHref("pry_1", "billing")).toBe("/projects/pry_1?tab=billing");
  });
});
