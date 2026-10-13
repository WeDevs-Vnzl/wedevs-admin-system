import { describe, expect, it } from "vitest";
import { PROJECT_DETAIL_TAB_VALUES } from "./detail-tabs";

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
});
