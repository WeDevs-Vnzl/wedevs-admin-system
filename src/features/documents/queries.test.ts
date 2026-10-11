import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { getDocumentPermissions, listDocumentCategories, listEntityDocuments } from "./queries";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("getDocumentPermissions", () => {
  it.each([
    ["OWNER", true, true],
    ["ADMIN", true, true],
    ["MEMBER", true, true],
    ["VIEWER", false, false],
  ] as const)("%s can attach: %s, can unlink: %s", async (role, canCreate, canUpdate) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    expect(await getDocumentPermissions()).toEqual({ canCreate, canUpdate });
  });
});

describe("listEntityDocuments", () => {
  it("lists the documents of one client and one project", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    const store = getMockStore();
    const client = store.clients.find((row) =>
      store.documentLinks.some((link) => link.entityType === "CLIENT" && link.entityId === row.id),
    )!;
    const clientPage = await listEntityDocuments({ type: "CLIENT", id: client.id });
    expect(clientPage.total).toBeGreaterThan(0);
    for (const row of clientPage.items) {
      expect(row.links.map((ref) => ref.id)).toContain(client.id);
    }

    const project = store.projects.find((row) =>
      store.documentLinks.some((link) => link.entityType === "PROJECT" && link.entityId === row.id),
    )!;
    const projectPage = await listEntityDocuments({ type: "PROJECT", id: project.id });
    expect(projectPage.total).toBeGreaterThan(0);
  });
});

describe("listDocumentCategories", () => {
  it("returns every category with its types, in catalog order", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    const categories = await listDocumentCategories();
    expect(categories.length).toBe(getMockStore().documentCategories.length);
    const orders = categories.map((category) => category.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
