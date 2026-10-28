import { describe, expect, it } from "vitest";
import { makeSessionUser } from "@/mocks/test-helpers";
import { clientScreenPermissions } from "./client-permissions";

describe("clientScreenPermissions", () => {
  it("gives Owner and Admin every clients control, including the trash and money", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(clientScreenPermissions(makeSessionUser(role), false)).toMatchObject({
        canCreate: true,
        canUpdate: true,
        canArchive: true,
        canRestore: true,
        canSeeFinancials: true,
        canReadActivity: true,
        canManageContacts: true,
      });
    }
  });

  it("keeps Member and Viewer to reading clients and contacts (HU-04)", () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const permissions = clientScreenPermissions(makeSessionUser(role), false);
      expect(permissions).toMatchObject({
        canCreate: false,
        canUpdate: false,
        canArchive: false,
        canRestore: false,
        canSeeFinancials: false,
        canManageContacts: false,
      });
    }
  });

  it("passes the server's inline tag grant through unchanged (canCreateTagsInline)", () => {
    expect(clientScreenPermissions(makeSessionUser("MEMBER"), true).canCreateTags).toBe(true);
    expect(clientScreenPermissions(makeSessionUser("VIEWER"), false).canCreateTags).toBe(false);
  });
});
