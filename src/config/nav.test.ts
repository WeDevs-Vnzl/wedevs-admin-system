import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth/types";
import {
  findNavItem,
  NAV_GROUPS,
  visibleNavGroups,
  visibleNavItems,
  visibleQuickActions,
} from "./nav";

function userWithRole(role: SessionUser["role"]): SessionUser {
  return {
    id: `usr_${role.toLowerCase()}`,
    name: "Test User",
    email: "test.user@example.com",
    imageUrl: null,
    role,
    locale: "en",
    theme: "system",
  };
}

describe("nav config", () => {
  it("lists every PRD §7.1 sidebar entry in its group order", () => {
    const keys = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.key));
    expect(keys).toEqual([
      "dashboard",
      "clients",
      "projects",
      "invoices",
      "payments",
      "expenses",
      "accounts",
      "documents",
      "shares",
      "notes",
      "graph",
      "reports",
      "activity",
    ]);
  });

  it("drops the finance group for a Member and keeps the rest", () => {
    const groups = visibleNavGroups(userWithRole("MEMBER"));
    const keys = groups.map((group) => group.key);
    expect(keys).not.toContain("finance");
    expect(keys).toContain("commercial");
    expect(visibleNavItems(userWithRole("MEMBER")).map((item) => item.key)).not.toContain(
      "reports",
    );
  });

  it("offers the create quick actions to Owner and Admin only", () => {
    expect(visibleQuickActions(userWithRole("OWNER"))).toHaveLength(7);
    expect(visibleQuickActions(userWithRole("ADMIN"))).toHaveLength(7);
    expect(visibleQuickActions(userWithRole("VIEWER"))).toHaveLength(0);
  });

  it("offers configuration to every signed-in role (M1: the settings frame filters its sections)", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      expect(visibleNavItems(userWithRole(role)).map((item) => item.key)).toContain("settings");
    }
  });

  it("resolves a route to the longest matching nav entry", () => {
    expect(findNavItem("/clients/123/edit")?.key).toBe("clients");
    expect(findNavItem("/settings/rates")?.key).toBe("settings");
    expect(findNavItem("/unknown")).toBeNull();
  });

  it("offers the portal links page to Owner and Admin only, resolved before documents", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(visibleNavItems(userWithRole(role)).map((item) => item.key)).toContain("shares");
    }
    for (const role of ["MEMBER", "VIEWER"] as const) {
      expect(visibleNavItems(userWithRole(role)).map((item) => item.key)).not.toContain("shares");
    }
    expect(findNavItem("/documents/shares/shl_1")?.href).toBe("/documents/shares");
    expect(findNavItem("/documents/doc_1")?.key).toBe("documents");
  });
});
