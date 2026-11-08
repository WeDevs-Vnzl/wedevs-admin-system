import { describe, expect, it } from "vitest";
import { FEATURES_OFF, type Features } from "@/lib/features";
import type { UserRole } from "@/lib/validators/enums";
import { SETTINGS_SECTIONS, findSettingsSection, isSettingsSectionVisible } from "./settings-nav";

const user = (role: UserRole) => ({ id: `usr_${role.toLowerCase()}`, role });

const ALL_ON: Features = { stripe: true, binance: true, bankSync: true };

const visibleSlugs = (role: UserRole, features: Features = ALL_ON) =>
  SETTINGS_SECTIONS.filter((section) =>
    isSettingsSectionVisible(section, user(role), features),
  ).map((section) => section.slug);

describe("settings sections (PRD §8.15)", () => {
  it("lists every section of §8.15 once", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.slug)).toEqual([
      "company",
      "users",
      "preferences",
      "api-tokens",
      "currencies",
      "rates",
      "fiscal",
      "payment-methods",
      "integrations",
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

  it("shows the catalogs, company and trash to Owner and Admin, and only preferences and API tokens to the rest", () => {
    const allSlugs = SETTINGS_SECTIONS.map((section) => section.slug);
    expect(visibleSlugs("OWNER")).toEqual(allSlugs);
    expect(visibleSlugs("ADMIN")).toEqual(allSlugs.filter((slug) => slug !== "users"));
    for (const role of ["MEMBER", "VIEWER"] as const) {
      expect(visibleSlugs(role)).toEqual(["preferences", "api-tokens"]);
    }
  });

  it("shows the integration mapping to Owner and Admin only, the grant the BE checks on /settings/integrations", () => {
    expect(findSettingsSection("integrations")).toMatchObject({
      labelKey: "integrations",
      permission: { action: "read", resource: "settings" },
    });
    expect(visibleSlugs("OWNER")).toContain("integrations");
    expect(visibleSlugs("ADMIN")).toContain("integrations");
    expect(visibleSlugs("MEMBER")).not.toContain("integrations");
    expect(visibleSlugs("VIEWER")).not.toContain("integrations");
  });

  it("keeps API tokens visible to every signed-in role, with no permission check (own tokens only)", () => {
    const apiTokens = findSettingsSection("api-tokens");
    expect(apiTokens).toMatchObject({ labelKey: "apiTokens", permission: null });
    expect(isSettingsSectionVisible(apiTokens!, null, ALL_ON)).toBe(false);
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      expect(isSettingsSectionVisible(apiTokens!, user(role), FEATURES_OFF)).toBe(true);
    }
  });

  it("keeps preferences visible to every signed-in role and hides everything without a user", () => {
    const preferences = findSettingsSection("preferences");
    expect(preferences).toBeDefined();
    expect(isSettingsSectionVisible(preferences!, null, ALL_ON)).toBe(false);
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      expect(isSettingsSectionVisible(preferences!, user(role), FEATURES_OFF)).toBe(true);
    }
  });

  it("hides Integraciones from every role while Stripe and Binance are both off (DT-227)", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      expect(visibleSlugs(role, FEATURES_OFF)).not.toContain("integrations");
    }
    expect(visibleSlugs("OWNER", { ...FEATURES_OFF, bankSync: true })).not.toContain(
      "integrations",
    );
  });

  it.each([
    ["Stripe", { ...FEATURES_OFF, stripe: true }],
    ["Binance", { ...FEATURES_OFF, binance: true }],
  ] as const)("shows Integraciones to Owner and Admin when only %s is on", (_label, features) => {
    expect(visibleSlugs("OWNER", features)).toContain("integrations");
    expect(visibleSlugs("ADMIN", features)).toContain("integrations");
    expect(visibleSlugs("MEMBER", features)).not.toContain("integrations");
  });

  it("keeps every other section regardless of the flags", () => {
    const withoutIntegrations = SETTINGS_SECTIONS.map((section) => section.slug).filter(
      (slug) => slug !== "integrations",
    );
    expect(visibleSlugs("OWNER", FEATURES_OFF)).toEqual(withoutIntegrations);
  });
});
