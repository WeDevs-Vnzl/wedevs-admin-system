// MOCK — tests for the Hito 1 mock bridge: the BE session user with the "View as role" override.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
const be = vi.hoisted(() => ({ getSessionUser: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "wd_mock_role" && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));
vi.mock("@/lib/auth/session", () => ({ getSessionUserOrRedirect: be.getSessionUser }));

import { buildMockStore } from "./store";
import { registerMockActor } from "./ctx";
import { FIXED_NOW } from "./test-helpers";
import {
  MOCK_DEFAULT_USER,
  MOCK_ROLE_COOKIE,
  MOCK_USERS,
  applyMockRoleOverride,
  getMockSessionUser,
  parseMockRole,
} from "./session";

/** The user the BE returned through `GET /api/v1/me` (a real person, not a fixture). */
const beUser: SessionUser = {
  id: "user_clerk_ana",
  name: "Ana Pérez",
  email: "ana.perez@example.com",
  imageUrl: null,
  role: "MEMBER",
  locale: "en",
  theme: "dark",
};

beforeEach(() => {
  cookieStore.value = undefined;
  be.getSessionUser.mockReset();
  be.getSessionUser.mockResolvedValue(beUser);
});

describe("mock fixtures", () => {
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

describe("applyMockRoleOverride", () => {
  it("keeps the identity and swaps only the role for a valid override", () => {
    expect(applyMockRoleOverride(beUser, "VIEWER")).toEqual({ ...beUser, role: "VIEWER" });
  });

  it("returns the user unchanged for a missing or invalid override, and never mutates it", () => {
    expect(applyMockRoleOverride(beUser, null)).toBe(beUser);
    expect(applyMockRoleOverride(beUser, "ROOT")).toBe(beUser);
    applyMockRoleOverride(beUser, "ADMIN");
    expect(beUser.role).toBe("MEMBER");
  });
});

describe("getMockSessionUser (cookie wd_mock_role)", () => {
  it("uses the cookie name documented for the override", () => {
    expect(MOCK_ROLE_COOKIE).toBe("wd_mock_role");
  });

  it("is null when the BE has no session user", async () => {
    be.getSessionUser.mockResolvedValue(null);
    expect(await getMockSessionUser()).toBeNull();
  });

  it("signs in the BE user, not the fixture Owner", async () => {
    expect(await getMockSessionUser()).toEqual(beUser);
    expect((await getMockSessionUser())?.id).not.toBe(MOCK_DEFAULT_USER.id);
  });

  it("applies a valid role from the cookie to the mock context user", async () => {
    cookieStore.value = "ADMIN";
    expect((await getMockSessionUser())?.role).toBe("ADMIN");
  });

  it("ignores a tampered cookie", async () => {
    cookieStore.value = "SUPERUSER";
    expect((await getMockSessionUser())?.role).toBe("MEMBER");
  });
});

describe("registerMockActor (ctx.ts)", () => {
  it("adds the signed-in user to the store users once, keeping its name for actor lookups", () => {
    const db = buildMockStore(FIXED_NOW, { fixedClock: true });
    const before = db.users.length;
    registerMockActor(db, beUser, FIXED_NOW);
    registerMockActor(db, beUser, FIXED_NOW);
    const rows = db.users.filter((row) => row.id === beUser.id);
    expect(db.users).toHaveLength(before + 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ana Pérez", email: "ana.perez@example.com" });
  });
});
