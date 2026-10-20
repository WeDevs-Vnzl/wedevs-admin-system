import { describe, expect, it } from "vitest";
import {
  changeUserRoleInputSchema,
  inviteUserInputSchema,
  userDetailSchema,
  userFilterSchema,
  userListRowSchema,
  userRefSchema,
} from "./users";

describe("users", () => {
  it("inviteUser needs a valid e-mail and defaults the role to ADMIN", () => {
    expect(inviteUserInputSchema.parse({ email: "ana@example.com" })).toEqual({
      email: "ana@example.com",
      role: "ADMIN",
    });
    expect(
      inviteUserInputSchema.safeParse({ email: "ana@example.com", role: "MEMBER" }).success,
    ).toBe(true);
    expect(inviteUserInputSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(
      inviteUserInputSchema.safeParse({ email: "ana@example.com", role: "ROOT" }).success,
    ).toBe(false);
  });

  it("changeUserRole needs a user id and a real role", () => {
    expect(changeUserRoleInputSchema.safeParse({ userId: "usr_1", role: "VIEWER" }).success).toBe(
      true,
    );
    expect(changeUserRoleInputSchema.safeParse({ userId: "usr_1", role: "SUPER" }).success).toBe(
      false,
    );
    expect(changeUserRoleInputSchema.safeParse({ role: "OWNER" }).success).toBe(false);
  });

  it("userFilter extends the list query with role/status facets", () => {
    const parsed = userFilterSchema.parse({ role: "OWNER", status: ["ACTIVE", "INVITED"] });
    expect(parsed.role).toEqual(["OWNER"]);
    expect(parsed.status).toEqual(["ACTIVE", "INVITED"]);
    expect(userFilterSchema.safeParse({ role: "NOPE" }).success).toBe(false);
    expect(userFilterSchema.safeParse({ sort: "password:asc" }).success).toBe(false);
  });

  it("list row and detail DTOs describe users and pending invitations", () => {
    const base = {
      id: "usr_1",
      name: "Andrés Molina",
      email: "andres.molina@example.com",
      imageUrl: null,
      role: "OWNER",
      createdAt: "2026-10-01T10:00:00.000Z",
    };
    expect(userListRowSchema.safeParse({ ...base, status: "ACTIVE" }).success).toBe(true);
    expect(userListRowSchema.safeParse({ ...base, name: null, status: "INVITED" }).success).toBe(
      true,
    );
    expect(
      userDetailSchema.safeParse({
        ...base,
        locale: "es",
        theme: "dark",
        updatedAt: "2026-10-02T10:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(userRefSchema.safeParse({ id: "usr_1", name: "A", imageUrl: null }).success).toBe(true);
  });
});
