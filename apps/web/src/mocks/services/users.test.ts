// MOCK — tests for the users services (PRD §8.15 "Usuarios", HU-02 CA1: Owner only).
import { describe, expect, it } from "vitest";
import {
  changeUserRoleInputSchema,
  inviteUserInputSchema,
  userFilterSchema,
  userListRowSchema,
  type UsersService,
} from "@/lib/validators/users";
import type { MockServiceContext } from "../ctx";
import { makeTestContext } from "../test-helpers";
import * as usersService from "./users";
import { changeUserRole, getUser, inviteUser, listUsers, revokeUserInvitation } from "./users";

const filter = (over: Record<string, unknown> = {}) => userFilterSchema.parse(over);

describe("HU-02 CA1: only the Owner sees /settings/users", () => {
  it("lists the users for the Owner", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const page = await listUsers(ctx, filter());
    expect(page.total).toBe(db.users.length);
    expect(page.items.every((row) => userListRowSchema.safeParse(row).success)).toBe(true);
    expect(page.items.every((row) => row.status === "ACTIVE")).toBe(true);
  });

  it("refuses Admin, Member and Viewer (FORBIDDEN) on every users service", async () => {
    for (const role of ["ADMIN", "MEMBER", "VIEWER"] as const) {
      const { ctx, db } = makeTestContext(role);
      await expect(listUsers(ctx, filter())).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        inviteUser(ctx, inviteUserInputSchema.parse({ email: "new@example.com" })),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        changeUserRole(ctx, { userId: "usr_diego_paredes", role: "ADMIN" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.users.find((user) => user.id === "usr_diego_paredes")?.role).toBe("MEMBER");
    }
  });
});

describe("listUsers", () => {
  it("filters by role and searches name or e-mail, sorted by name", async () => {
    const { ctx } = makeTestContext("OWNER");
    const owners = await listUsers(ctx, filter({ role: ["OWNER"] }));
    expect(owners.items.map((row) => row.id)).toEqual(["usr_andres_molina", "usr_valeria_rojas"]);
    const search = await listUsers(ctx, filter({ q: "camila.torres" }));
    expect(search.items.map((row) => row.id)).toEqual(["usr_camila_torres"]);
  });
});

describe("inviteUser", () => {
  it("adds an INVITED row (Admin by default) that listUsers returns, and logs it", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const before = db.activity.length;
    const row = await inviteUser(ctx, inviteUserInputSchema.parse({ email: "Nueva@Example.com" }));
    expect(row).toMatchObject({
      email: "nueva@example.com",
      role: "ADMIN",
      status: "INVITED",
      name: null,
      createdAt: ctx.now.toISOString(),
    });
    const invited = await listUsers(ctx, filter({ status: ["INVITED"] }));
    expect(invited.items).toEqual([row]);
    expect(db.activity).toHaveLength(before + 1);
    expect(db.activity.at(-1)).toMatchObject({ action: "CREATE", entityType: "USER" });
  });

  it("refuses an e-mail that already has a user or a pending invitation (CONFLICT)", async () => {
    const { ctx } = makeTestContext("OWNER");
    await expect(
      inviteUser(ctx, inviteUserInputSchema.parse({ email: "andres.molina@example.com" })),
    ).rejects.toMatchObject({ code: "CONFLICT", fieldErrors: { email: expect.any(Array) } });
    await inviteUser(ctx, inviteUserInputSchema.parse({ email: "x@example.com" }));
    await expect(
      inviteUser(ctx, inviteUserInputSchema.parse({ email: "X@example.com" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("revokeUserInvitation", () => {
  it("removes the pending invitation; an unknown one is NOT_FOUND", async () => {
    const { ctx } = makeTestContext("OWNER");
    const row = await inviteUser(ctx, inviteUserInputSchema.parse({ email: "y@example.com" }));
    expect(await revokeUserInvitation(ctx, { invitationId: row.id })).toEqual({
      invitationId: row.id,
    });
    expect((await listUsers(ctx, filter({ status: ["INVITED"] }))).total).toBe(0);
    await expect(revokeUserInvitation(ctx, { invitationId: row.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("changeUserRole", () => {
  it("changes the role, stamps updatedAt and logs the diff", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const detail = await changeUserRole(
      ctx,
      changeUserRoleInputSchema.parse({ userId: "usr_diego_paredes", role: "ADMIN" }),
    );
    expect(detail).toMatchObject({ id: "usr_diego_paredes", role: "ADMIN" });
    expect(db.users.find((user) => user.id === "usr_diego_paredes")).toMatchObject({
      role: "ADMIN",
      updatedAt: ctx.now.toISOString(),
    });
    expect(db.activity.at(-1)).toMatchObject({
      action: "UPDATE",
      entityType: "USER",
      entityId: "usr_diego_paredes",
      changes: { role: ["MEMBER", "ADMIN"] },
    });
  });

  it("never demotes the last Owner (INTEGRITY_LOCK)", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    await changeUserRole(ctx, { userId: "usr_valeria_rojas", role: "ADMIN" });
    await expect(
      changeUserRole(ctx, { userId: "usr_andres_molina", role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
    expect(db.users.find((user) => user.id === "usr_andres_molina")?.role).toBe("OWNER");
  });

  it("an unknown user is NOT_FOUND", async () => {
    const { ctx } = makeTestContext("OWNER");
    await expect(
      changeUserRole(ctx, { userId: "usr_nobody", role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getUser", () => {
  it("returns the detail to the Owner and to the user themself, FORBIDDEN otherwise", async () => {
    const owner = makeTestContext("OWNER");
    expect(await getUser(owner.ctx, { id: "usr_camila_torres" })).toMatchObject({
      id: "usr_camila_torres",
      role: "ADMIN",
    });
    const self = makeTestContext("ADMIN", { id: "usr_camila_torres" });
    expect((await getUser(self.ctx, { id: "usr_camila_torres" })).id).toBe("usr_camila_torres");
    await expect(getUser(self.ctx, { id: "usr_andres_molina" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("satisfies UsersService over the mock context", () => {
    const service = usersService satisfies UsersService<MockServiceContext>;
    expect(typeof service.listUsers).toBe("function");
  });
});
