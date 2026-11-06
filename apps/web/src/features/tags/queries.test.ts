import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import type { UserRole } from "@/lib/validators/enums";

vi.mock("server-only", () => ({}));
const { getServiceContext } = vi.hoisted(() => ({ getServiceContext: vi.fn() }));
vi.mock("@/server/context", () => ({ getServiceContext }));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@/lib/api/server", () => server);

import { canCreateTagsInline, canManageTags, getTag, getTags } from "./queries";

function asRole(role: UserRole) {
  getServiceContext.mockResolvedValue({ user: { id: "usr_test", role } });
}

const tag = { id: "tag_ur", name: "Urgente", color: "#ff0000", usageCount: 3, createdAt: "2026-01-01T00:00:00.000Z" };

describe("getTags", () => {
  it("reads the catalogue with usage counts through GET /api/v1/tags", async () => {
    const { api, calls } = mockApi({
      "GET /api/v1/tags": { body: { items: [tag], total: 1, page: 1, pageSize: 25, pageCount: 1 } },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(getTags({ q: "ur" })).resolves.toMatchObject({ items: [tag], total: 1 });
    expect(calls[0]?.path).toBe("/api/v1/tags");
    expect(calls[0]?.search.get("q")).toBe("ur");
  });

  it("throws when the BE answers with an error envelope", async () => {
    const { api } = mockApi({ "GET /api/v1/tags": errorEnvelope("INTERNAL") });
    server.getServerApi.mockResolvedValue(api);

    await expect(getTags()).rejects.toThrow("GET /api/v1/tags failed with 500");
  });
});

describe("getTag", () => {
  it("reads one tag through GET /api/v1/tags/{id}", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/tags/{id}": { body: tag } });
    server.getServerApi.mockResolvedValue(api);

    await expect(getTag("tag_ur")).resolves.toMatchObject({ id: "tag_ur", usageCount: 3 });
    expect(calls[0]?.path).toBe("/api/v1/tags/tag_ur");
  });
});

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
