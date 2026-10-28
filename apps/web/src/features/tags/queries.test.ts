import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@/lib/validators/enums";

vi.mock("server-only", () => ({}));
const { getServiceContext } = vi.hoisted(() => ({ getServiceContext: vi.fn() }));
vi.mock("@/server/context", () => ({ getServiceContext }));

import { canCreateTagsInline, canManageTags } from "./queries";

function asRole(role: UserRole) {
  getServiceContext.mockResolvedValue({ user: { id: "usr_test", role } });
}

describe("canManageTags", () => {
  beforeEach(() => getServiceContext.mockReset());

  it.each(["OWNER", "ADMIN"] as const)("lets %s manage the catalogue", async (role) => {
    asRole(role);
    await expect(canManageTags()).resolves.toBe(true);
  });

  it.each(["MEMBER", "VIEWER"] as const)("keeps the catalogue from %s", async (role) => {
    asRole(role);
    await expect(canManageTags()).resolves.toBe(false);
  });
});

describe("canCreateTagsInline", () => {
  beforeEach(() => getServiceContext.mockReset());

  // The grants of createTagAction: Owner, Admin and Member hold one of them, Viewer holds none.
  it.each(["OWNER", "ADMIN", "MEMBER"] as const)("lets %s create a tag inline", async (role) => {
    asRole(role);
    await expect(canCreateTagsInline()).resolves.toBe(true);
  });

  it("keeps inline creation from VIEWER, who holds none of the tag grants", async () => {
    asRole("VIEWER");
    await expect(canCreateTagsInline()).resolves.toBe(false);
  });
});
