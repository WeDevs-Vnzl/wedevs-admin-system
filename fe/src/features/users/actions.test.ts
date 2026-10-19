import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);

import type { UserRole } from "@/lib/validators/enums";
import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  changeUserRoleAction,
  inviteUserAction,
  listUsersAction,
  revokeUserInvitationAction,
} from "./actions";

const signIn = (role: UserRole) =>
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: "usr_actor" }));

beforeEach(() => session.getMockSessionUser.mockReset());
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("users actions (PRD §8.15 Usuarios, Owner only)", () => {
  it("lists the users with their role for the Owner", async () => {
    signIn("OWNER");
    const result = await listUsersAction({});
    expect(result.ok && result.data.total).toBe(getMockStore().users.length);
    expect(result.ok && result.data.items[0]).toMatchObject({ status: "ACTIVE" });
  });

  it.each(["ADMIN", "MEMBER", "VIEWER"] as const)("refuses %s", async (role) => {
    signIn(role);
    expect(await listUsersAction({})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await inviteUserAction({ email: "x@example.com", role: "ADMIN" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("invites by e-mail, lists the invitation and revokes it", async () => {
    signIn("OWNER");
    const invited = await inviteUserAction({ email: "New.Person@example.com", role: "MEMBER" });
    expect(invited).toMatchObject({
      ok: true,
      data: { email: "new.person@example.com", role: "MEMBER", status: "INVITED" },
    });
    const pending = await listUsersAction({ status: ["INVITED"] });
    expect(pending.ok && pending.data.items.map((row) => row.email)).toEqual([
      "new.person@example.com",
    ]);
    const id = invited.ok ? invited.data.id : "";
    expect(await revokeUserInvitationAction({ invitationId: id })).toMatchObject({ ok: true });
    const after = await listUsersAction({ status: ["INVITED"] });
    expect(after.ok && after.data.total).toBe(0);
  });

  it("puts settings.users.errors.emailTaken on the e-mail of a taken address", async () => {
    signIn("OWNER");
    const email = getMockStore().users[0]!.email;
    expect(await inviteUserAction({ email, role: "ADMIN" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", fieldErrors: { email: ["settings.users.errors.emailTaken"] } },
    });
  });

  it("changes a role and refuses to demote the last Owner", async () => {
    signIn("OWNER");
    const db = getMockStore();
    const admin = db.users.find((user) => user.role !== "OWNER")!;
    expect(await changeUserRoleAction({ userId: admin.id, role: "VIEWER" })).toMatchObject({
      ok: true,
      data: { id: admin.id, role: "VIEWER" },
    });
    const owners = db.users.filter((user) => user.role === "OWNER");
    for (const owner of owners.slice(1)) owner.role = "ADMIN";
    expect(await changeUserRoleAction({ userId: owners[0]!.id, role: "ADMIN" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "settings.users.errors.lastOwner" },
    });
  });
});
