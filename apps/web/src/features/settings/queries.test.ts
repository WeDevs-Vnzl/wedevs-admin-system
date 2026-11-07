import { beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ getServiceContext: vi.fn() }));
const holder = vi.hoisted(() => ({ api: undefined as unknown }));
const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/context", () => context);
vi.mock("next/navigation", () => nav);
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => holder.api }));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import type { UserRole } from "@/lib/validators/enums";
import { makeSessionUser } from "@/lib/auth/testing";
import {
  getCompanySettings,
  getOpenableSettingsSection,
  getVisibleSettingsSections,
} from "./queries";

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

  it("keeps the other sections as before: Admin sees company and trash, Members only preferences and API tokens", async () => {
    signIn("ADMIN");
    expect(await slugs()).toEqual(
      expect.arrayContaining(["company", "preferences", "trash", "integrations"]),
    );
    signIn("MEMBER");
    expect(await slugs()).toEqual(["preferences", "api-tokens"]);
    expect(await getOpenableSettingsSection("unknown")).toBeNull();
  });
});

describe("getCompanySettings (GET /settings/company)", () => {
  it("returns the profile with null columns as absent values", async () => {
    const { calls } = mockedCompany({
      body: { name: "WeDevs", legalName: null, taxId: "J-1", address: null, logoFileId: "f1" },
    });
    expect(await getCompanySettings()).toEqual({
      name: "WeDevs",
      legalName: undefined,
      taxId: "J-1",
      address: undefined,
      logoFileId: "f1",
    });
    expect(calls[0]?.path).toBe("/api/v1/settings/company");
  });

  it("renders the in-shell not-found for FORBIDDEN", async () => {
    mockedCompany(errorEnvelope("FORBIDDEN"));
    await expect(getCompanySettings()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

function mockedCompany(response: Parameters<typeof mockApi>[0][string]) {
  const mocked = mockApi({ "GET /api/v1/settings/company": response });
  holder.api = mocked.api;
  return mocked;
}
