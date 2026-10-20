import { beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ getServiceContext: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/context", () => context);

import type { UserRole } from "@/lib/validators/enums";
import { makeSessionUser } from "@/mocks/test-helpers";
import { getOpenableSettingsSection, getVisibleSettingsSections } from "./queries";

const signIn = (role: UserRole) =>
  context.getServiceContext.mockResolvedValue({ user: makeSessionUser(role) });

const slugs = async () => (await getVisibleSettingsSections()).map((section) => section.slug);

beforeEach(() => context.getServiceContext.mockReset());

describe("HU-02 CA1: only the Owner sees /settings/users", () => {
  it("shows the users entry to the Owner and lets them open it", async () => {
    signIn("OWNER");
    expect(await slugs()).toContain("users");
    expect(await getOpenableSettingsSection("users")).toMatchObject({ slug: "users" });
  });

  it.each(["ADMIN", "MEMBER", "VIEWER"] as const)(
    "hides the entry from %s and refuses to open it",
    async (role) => {
      signIn(role);
      expect(await slugs()).not.toContain("users");
      expect(await getOpenableSettingsSection("users")).toBeNull();
    },
  );

  it("keeps the other sections as before: Admin sees company and trash, Members only preferences", async () => {
    signIn("ADMIN");
    expect(await slugs()).toEqual(expect.arrayContaining(["company", "preferences", "trash"]));
    signIn("MEMBER");
    expect(await slugs()).toEqual(["preferences"]);
    expect(await getOpenableSettingsSection("unknown")).toBeNull();
  });
});
