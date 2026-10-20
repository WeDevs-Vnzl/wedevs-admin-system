// MOCK — tests for the Hito 1 mock session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "wd_mock_role" && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));

import {
  MOCK_DEFAULT_USER,
  MOCK_ROLE_COOKIE,
  MOCK_USERS,
  getMockSessionUser,
  parseMockRole,
  resolveMockSessionUser,
} from "./session";

beforeEach(() => {
  cookieStore.value = undefined;
});

describe("mock users", () => {
  it("are two fictional Owners with example.com addresses", () => {
    expect(MOCK_USERS).toHaveLength(2);
    for (const u of MOCK_USERS) {
      expect(u.role).toBe("OWNER");
      expect(u.email.endsWith("@example.com")).toBe(true);
    }
    expect(new Set(MOCK_USERS.map((u) => u.id)).size).toBe(2);
    expect(MOCK_DEFAULT_USER).toBe(MOCK_USERS[0]);
  });
});

describe("parseMockRole", () => {
  it("accepts only real roles", () => {
    expect(parseMockRole("VIEWER")).toBe("VIEWER");
    expect(parseMockRole("viewer")).toBeNull();
    expect(parseMockRole("ROOT")).toBeNull();
    expect(parseMockRole("")).toBeNull();
    expect(parseMockRole(undefined)).toBeNull();
    expect(parseMockRole(null)).toBeNull();
  });
});

describe("resolveMockSessionUser", () => {
  it("returns the default Owner without an override", () => {
    expect(resolveMockSessionUser()).toEqual(MOCK_DEFAULT_USER);
    expect(resolveMockSessionUser(null).role).toBe("OWNER");
  });

  it("keeps the identity and swaps only the role", () => {
    const user = resolveMockSessionUser("MEMBER");
    expect(user).toEqual({ ...MOCK_DEFAULT_USER, role: "MEMBER" });
  });

  it("ignores an invalid override and never mutates the fixtures", () => {
    expect(resolveMockSessionUser("ROOT").role).toBe("OWNER");
    resolveMockSessionUser("VIEWER");
    expect(MOCK_DEFAULT_USER.role).toBe("OWNER");
  });
});

describe("getMockSessionUser (cookie wd_mock_role)", () => {
  it("uses the cookie name documented for the override", () => {
    expect(MOCK_ROLE_COOKIE).toBe("wd_mock_role");
  });

  it("returns the Owner when the cookie is absent", async () => {
    expect(await getMockSessionUser()).toEqual(MOCK_DEFAULT_USER);
  });

  it("applies a valid role from the cookie", async () => {
    cookieStore.value = "ADMIN";
    expect((await getMockSessionUser())?.role).toBe("ADMIN");
  });

  it("ignores a tampered cookie", async () => {
    cookieStore.value = "SUPERUSER";
    expect((await getMockSessionUser())?.role).toBe("OWNER");
  });
});
