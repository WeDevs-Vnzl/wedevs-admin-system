import { describe, expect, it } from "vitest";
import type { UserRole } from "@/lib/validators/enums";
import { SETTINGS_SECTIONS, findSettingsSection, isSettingsSectionVisible } from "./settings-nav";

const user = (role: UserRole) => ({ id: `usr_${role.toLowerCase()}`, role });

const visibleSlugs = (role: UserRole) =>
  SETTINGS_SECTIONS.filter((section) => isSettingsSectionVisible(section, user(role))).map(
    (section) => section.slug,
  );

describe("settings sections (PRD §8.15)", () => {
  it("lists every section of §8.15 once", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.slug)).toEqual([
      "company",
      "users",
      "preferences",
      "currencies",
      "rates",
      "fiscal",
      "payment-methods",
      "technologies",
      "document-types",
      "expense-categories",
      "tags",
      "trash",
    ]);
  });

  it("shows Users only to the Owner", () => {
    expect(visibleSlugs("OWNER")).toContain("users");
    expect(visibleSlugs("ADMIN")).not.toContain("users");
    expect(visibleSlugs("MEMBER")).not.toContain("users");
    expect(visibleSlugs("VIEWER")).not.toContain("users");
  });

  it("shows the catalogs, company and trash to Owner and Admin, and only preferences to the rest", () => {
    const allSlugs = SETTINGS_SECTIONS.map((section) => section.slug);
    expect(visibleSlugs("OWNER")).toEqual(allSlugs);
    expect(visibleSlugs("ADMIN")).toEqual(allSlugs.filter((slug) => slug !== "users"));
    for (const role of ["MEMBER", "VIEWER"] as const) {
      expect(visibleSlugs(role)).toEqual(["preferences"]);
    }
  });

  it("keeps preferences visible to every signed-in role and hides everything without a user", () => {
    const preferences = findSettingsSection("preferences");
    expect(preferences).toBeDefined();
    expect(isSettingsSectionVisible(preferences!, null)).toBe(false);
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      expect(isSettingsSectionVisible(preferences!, user(role))).toBe(true);
    }
  });
});
