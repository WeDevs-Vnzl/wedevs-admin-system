import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
// The catalogs module reads document categories through the API (HTTP double, not a mocked domain layer).
const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

// The overview and detail reads of the documents service are stubbed (their mock implementation is another
// task); every other service function stays the real one over the mock store.
const service = vi.hoisted(() => ({ getDocumentsOverview: vi.fn(), getDocument: vi.fn() }));
vi.mock("@/mocks/services/documents", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...service,
}));

// The commercial reads are stubbed at the module boundary (their own swaps own their HTTP tests).
const commercial = vi.hoisted(() => ({ getClient: vi.fn(), getProject: vi.fn() }));
vi.mock("@/features/clients/queries", () => ({ getClient: commercial.getClient }));
vi.mock("@/features/projects/queries", () => ({ getProject: commercial.getProject }));

import { ServiceError } from "@/server/errors";
import { mockApi } from "@/lib/api/testing";
import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  documentLinkPrefill,
  getDocument,
  getDocumentPermissions,
  getDocumentsOverview,
  listDocumentCategories,
  listEntityDocuments,
} from "./queries";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  service.getDocumentsOverview.mockReset();
  service.getDocument.mockReset();
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
    const clientPage = await listEntityDocuments({
      type: "CLIENT",
      id: client.id,
      label: client.tradeName,
    });
    expect(clientPage.total).toBeGreaterThan(0);
    for (const row of clientPage.items) {
      expect(row.links.map((ref) => ref.id)).toContain(client.id);
    }

    const project = store.projects.find((row) =>
      store.documentLinks.some((link) => link.entityType === "PROJECT" && link.entityId === row.id),
    )!;
    const projectPage = await listEntityDocuments({
      type: "PROJECT",
      id: project.id,
      label: project.name,
    });
    expect(projectPage.total).toBeGreaterThan(0);
  });

  it("returns every linked document past one page of 100, so the tab counts and filters over all of them", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    const store = getMockStore();
    const base = store.documents.find((row) => row.archivedAt === null)!;
    const baseLink = store.documentLinks[0]!;
    for (let index = 0; index < 120; index += 1) {
      const id = `doc_bulk_${index}`;
      store.documents.push({ ...base, id, code: `DOC-9${String(index).padStart(3, "0")}` });
      store.documentLinks.push({
        ...baseLink,
        id: `dlk_bulk_${index}`,
        documentId: id,
        entityType: "CLIENT",
        entityId: "cli_kairos",
      });
    }
    const page = await listEntityDocuments({ type: "CLIENT", id: "cli_kairos", label: "Kairos" });
    expect(page.total).toBeGreaterThan(120);
    expect(page.items).toHaveLength(page.total);
    expect(new Set(page.items.map((row) => row.id)).size).toBe(page.total);
  });

  it("answers an empty page for an entity the tab does not serve", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    const store = getMockStore();
    const contact = store.contacts[0]!;
    expect(
      await listEntityDocuments({ type: "CONTACT", id: contact.id, label: "x" }),
    ).toMatchObject({
      items: [],
      total: 0,
    });
  });
});

describe("listDocumentCategories", () => {
  it("returns every category with its types, in catalog order", async () => {
    const category = (id: string, order: number) => ({
      id,
      name: id,
      nameEn: null,
      color: null,
      order,
      types: [],
    });
    const { api, calls } = mockApi({
      "GET /api/v1/document-categories": { body: [category("a", 0), category("b", 1)] },
    });
    server.api = api;
    const categories = await listDocumentCategories();
    expect(calls).toHaveLength(1);
    expect(categories.map((c) => c.id)).toEqual(["a", "b"]);
    const orders = categories.map((c) => c.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe("getDocumentsOverview", () => {
  it("reads the overview for the signed-in user with the empty overview input", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    const overview = { recent: [] };
    service.getDocumentsOverview.mockResolvedValue(overview);
    expect(await getDocumentsOverview()).toBe(overview);
    expect(service.getDocumentsOverview).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ role: "VIEWER" }) }),
      {},
    );
  });
});

describe("getDocument", () => {
  it("reads one document by id", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    service.getDocument.mockResolvedValue({ id: "doc_1" });
    expect(await getDocument("doc_1")).toEqual({ id: "doc_1" });
    expect(service.getDocument).toHaveBeenCalledWith(expect.anything(), { id: "doc_1" });
  });

  it("rejects an empty id before the service runs", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    await expect(getDocument("")).rejects.toThrow();
    expect(service.getDocument).not.toHaveBeenCalled();
  });
});

describe("documentLinkPrefill", () => {
  beforeEach(() => {
    commercial.getClient.mockReset();
    commercial.getProject.mockReset();
    commercial.getClient.mockImplementation(async (id: string) => {
      if (id === "cli_kairos") {
        return { id, code: "CLI-0001", tradeName: "Kairos Studio", archivedAt: null };
      }
      if (id === "cli_archived") {
        return { id, code: "CLI-0002", tradeName: "Archivada", archivedAt: "2026-10-01T00:00:00Z" };
      }
      throw new ServiceError("NOT_FOUND");
    });
    commercial.getProject.mockImplementation(async (id: string) => {
      if (id === "prj_portal") {
        return { id, code: "PRJ-0001", name: "Portal web", archivedAt: null };
      }
      throw new ServiceError("NOT_FOUND");
    });
  });

  it("prefills the client a document is created from, labelled with its trade name", async () => {
    expect(await documentLinkPrefill("CLIENT", "cli_kairos")).toEqual([
      { type: "CLIENT", id: "cli_kairos", code: "CLI-0001", label: "Kairos Studio" },
    ]);
  });

  it("prefills the project a document is created from, labelled with its name", async () => {
    expect(await documentLinkPrefill("PROJECT", "prj_portal")).toEqual([
      { type: "PROJECT", id: "prj_portal", code: "PRJ-0001", label: "Portal web" },
    ]);
  });

  it("prefills nothing for a missing, unknown or unsupported record", async () => {
    expect(await documentLinkPrefill(undefined, undefined)).toEqual([]);
    expect(await documentLinkPrefill("CLIENT", "")).toEqual([]);
    expect(await documentLinkPrefill("CLIENT", "cli_missing")).toEqual([]);
    expect(await documentLinkPrefill("PROJECT", "cli_kairos")).toEqual([]);
    expect(await documentLinkPrefill("INVOICE", "cli_kairos")).toEqual([]);
  });

  it("prefills nothing for an archived client", async () => {
    expect(await documentLinkPrefill("CLIENT", "cli_archived")).toEqual([]);
  });
});
