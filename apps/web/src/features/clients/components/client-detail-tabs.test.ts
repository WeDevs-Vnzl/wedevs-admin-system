import { describe, expect, it } from "vitest";
import { visibleClientDetailTabs } from "./client-detail-tabs";

describe("visibleClientDetailTabs", () => {
  it("shows every tab to Owner and Admin", () => {
    expect(visibleClientDetailTabs({ canSeeFinancials: true, canReadActivity: true })).toEqual([
      "summary",
      "contacts",
      "projects",
      "invoices",
      "payments",
      "documents",
      "notes",
      "activity",
    ]);
  });

  it("drops the finance tabs without financial access and the activity tab without the activity grant", () => {
    expect(visibleClientDetailTabs({ canSeeFinancials: false, canReadActivity: false })).toEqual([
      "summary",
      "contacts",
      "projects",
      "documents",
      "notes",
    ]);
  });

  it("keeps the activity tab alone when only the activity grant is present", () => {
    const tabs = visibleClientDetailTabs({ canSeeFinancials: false, canReadActivity: true });
    expect(tabs).toContain("activity");
    expect(tabs).not.toContain("invoices");
    expect(tabs).not.toContain("payments");
  });
});
