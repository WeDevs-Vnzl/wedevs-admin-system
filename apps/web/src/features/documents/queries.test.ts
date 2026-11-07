import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
// Both the documents reads and the catalogs module read through the API (HTTP double, not a mocked domain layer).
const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

// The commercial reads are stubbed at the module boundary (their own swaps own their HTTP tests).
const commercial = vi.hoisted(() => ({ getClient: vi.fn(), getProject: vi.fn() }));
vi.mock("@/features/clients/queries", () => ({ getClient: commercial.getClient }));
vi.mock("@/features/projects/queries", () => ({ getProject: commercial.getProject }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { ServiceError } from "@/server/errors";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  documentLinkPrefill,
  getDocument,
  getDocumentDetailPermissions,
  getDocumentPermissions,
  getDocumentsOverview,
  listDocumentCategories,
  listDocumentVersions,
  listDocuments,
  listEntityDocuments,
  readDocumentDetail,
  readDocumentVersion,
} from "./queries";
import { wireDetail, wirePage, wireRow, wireVersion } from "./wire-fixtures";

function use(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.api = mocked.api;
  return mocked;
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("getDocumentPermissions", () => {
  it.each([
    ["OWNER", true, true, true],
    ["ADMIN", true, true, true],
    ["MEMBER", true, true, false],
    ["VIEWER", false, false, false],
  ] as const)(
    "%s can attach: %s, can unlink: %s, can see archived: %s",
    async (role, canCreate, canUpdate, canRestore) => {
      session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
      expect(await getDocumentPermissions()).toEqual({ canCreate, canUpdate, canRestore });
    },
  );
});

describe("listDocuments", () => {
  it("reads one page through GET /api/v1/documents with the table's filter", async () => {
    const { calls } = use({ "GET /api/v1/documents": { body: wirePage([wireRow()]) } });
    const page = await listDocuments({ q: "contrato", status: ["BORRADOR"], page: 2 });
    expect(page.items[0]).toMatchObject({ id: "doc_1", code: "DOC-0001" });
    // The wire `null` code of a chip is parsed away.
    expect(page.items[0]?.links[0]).toEqual({
      type: "CLIENT",
      id: "cli_1",
      label: "Kairos",
    });
    expect(calls[0]?.search.get("q")).toBe("contrato");
    expect(calls[0]?.search.getAll("status")).toEqual(["BORRADOR"]);
    expect(calls[0]?.search.get("page")).toBe("2");
  });

  it("throws when the BE answers an error", async () => {
    use({ "GET /api/v1/documents": errorEnvelope("INTERNAL") });
    await expect(listDocuments()).rejects.toThrow("GET /api/v1/documents failed with 500");
  });
});

describe("listEntityDocuments", () => {
  const facets = [
    ["CLIENT", "clientId"],
    ["CONTACT", "contactId"],
    ["PROJECT", "projectId"],
    ["INVOICE", "invoiceId"],
    ["PAYMENT", "paymentId"],
    ["EXPENSE", "expenseId"],
  ] as const;

  it.each(facets)("filters a %s's documents by its %s facet (HU-20 CA1)", async (type, facet) => {
    const { calls } = use({ "GET /api/v1/documents": { body: wirePage([wireRow()]) } });
    const page = await listEntityDocuments({ type, id: "ent_1", label: "x" });
    expect(page.total).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.search.getAll(facet)).toEqual(["ent_1"]);
    expect(calls[0]?.search.get("pageSize")).toBe("100");
    expect(calls[0]?.search.get("archived")).toBe("exclude");
  });

  it("returns every linked document past one page of 100, so the tab counts and filters over all of them", async () => {
    const rows = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => wireRow({ id: `doc_${from + index}` }));
    const { calls } = use({
      "GET /api/v1/documents": (call) => ({
        body:
          call.search.get("page") === "1"
            ? { ...wirePage(rows(0, 100), 120), pageSize: 100, pageCount: 2 }
            : { ...wirePage(rows(100, 20), 120), page: 2, pageSize: 100, pageCount: 2 },
      }),
    });
    const page = await listEntityDocuments({ type: "CLIENT", id: "cli_1", label: "Kairos" });
    expect(page.total).toBe(120);
    expect(new Set(page.items.map((row) => row.id)).size).toBe(120);
    expect(calls.map((call) => call.search.get("page"))).toEqual(["1", "2"]);
  });

  it("answers an empty page, with no call, for an entity that has no facet", async () => {
    const { calls } = use({});
    expect(await listEntityDocuments({ type: "ACCOUNT", id: "acc_1", label: "x" })).toEqual({
      items: [],
      total: 0,
    });
    expect(calls).toHaveLength(0);
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
    const { calls } = use({
      "GET /api/v1/document-categories": { body: [category("a", 0), category("b", 1)] },
    });
    const categories = await listDocumentCategories();
    expect(calls).toHaveLength(1);
    expect(categories.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("getDocumentsOverview", () => {
  it("reads GET /api/v1/documents/overview and parses the chips of its lists", async () => {
    const { calls } = use({
      "GET /api/v1/documents/overview": {
        body: {
          byCategoryAndStatus: [],
          expiringCounts: { days30: 1, days60: 2, days90: 3 },
          expiringSoon: [wireRow()],
          recent: [],
          staleDrafts: [],
        },
      },
    });
    const overview = await getDocumentsOverview();
    expect(calls[0]?.path).toBe("/api/v1/documents/overview");
    expect(overview.expiringCounts).toEqual({ days30: 1, days60: 2, days90: 3 });
    expect(overview.expiringSoon[0]?.links[0]).toEqual({
      type: "CLIENT",
      id: "cli_1",
      label: "Kairos",
    });
  });
});

describe("getDocument (frozen cross-module read, rule 11)", () => {
  it("reads one document by id", async () => {
    const { calls } = use({ "GET /api/v1/documents/{id}": { body: wireDetail() } });
    const document = await getDocument("doc_1");
    expect(document).toMatchObject({ id: "doc_1", code: "DOC-0001", title: "Contrato Kairos" });
    expect(calls[0]?.path).toBe("/api/v1/documents/doc_1");
  });

  it("maps a BE 404 to ServiceError NOT_FOUND", async () => {
    use({ "GET /api/v1/documents/{id}": errorEnvelope("NOT_FOUND") });
    await expect(getDocument("doc_x")).rejects.toMatchObject({
      name: "ServiceError",
      code: "NOT_FOUND",
    });
  });

  it("maps a BE 403 to FORBIDDEN and a 422 to VALIDATION, keeping message and field errors", async () => {
    use({ "GET /api/v1/documents/{id}": errorEnvelope("FORBIDDEN") });
    await expect(getDocument("doc_1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    use({
      "GET /api/v1/documents/{id}": errorEnvelope("VALIDATION", {
        message: "documents.errors.bad",
        fieldErrors: { id: ["validation.invalidId"] },
      }),
    });
    await expect(getDocument("doc_1")).rejects.toMatchObject({
      code: "VALIDATION",
      message: "documents.errors.bad",
      fieldErrors: { id: ["validation.invalidId"] },
    });
  });

  it("answers a malformed id like an unknown one, without calling the BE", async () => {
    const { calls } = use({});
    await expect(getDocument("")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDocument("a b/c")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toHaveLength(0);
  });

  it("throws a plain error on a server failure", async () => {
    use({ "GET /api/v1/documents/{id}": errorEnvelope("INTERNAL") });
    await expect(getDocument("doc_1")).rejects.not.toBeInstanceOf(ServiceError);
  });
});

describe("detail reads", () => {
  it("readDocumentDetail answers null for an unknown, hidden or malformed id", async () => {
    use({ "GET /api/v1/documents/{id}": errorEnvelope("NOT_FOUND") });
    expect(await readDocumentDetail("doc_x")).toBeNull();
    use({ "GET /api/v1/documents/{id}": errorEnvelope("FORBIDDEN") });
    expect(await readDocumentDetail("doc_x")).toBeNull();
    expect(await readDocumentDetail("not valid!")).toBeNull();
  });

  it("lists the history through GET /documents/{id}/versions, newest first, without content", async () => {
    const { calls } = use({
      "GET /api/v1/documents/{id}/versions": {
        body: [wireVersion(), wireVersion({ id: "ver_1", versionNumber: 1, isCurrent: false })],
      },
    });
    const versions = await listDocumentVersions("doc_1");
    expect(calls[0]?.path).toBe("/api/v1/documents/doc_1/versions");
    expect(versions.map((version) => version.versionNumber)).toEqual([2, 1]);
  });

  it("reads one version with its content, and null when the BE says it is not found", async () => {
    use({
      "GET /api/v1/documents/{id}/versions/{versionId}": (call) =>
        call.path.endsWith("ver_nope")
          ? errorEnvelope("NOT_FOUND")
          : { body: wireVersion({ format: "MARKDOWN", file: null, content: "# Hola" }) },
    });
    expect(await readDocumentVersion("doc_1", "ver_2")).toMatchObject({ content: "# Hola" });
    expect(await readDocumentVersion("doc_1", "ver_nope")).toBeNull();
  });
});

describe("getDocumentDetailPermissions", () => {
  it.each([
    ["OWNER", true, true],
    ["ADMIN", true, true],
    ["MEMBER", true, false],
    ["VIEWER", false, false],
  ] as const)("%s can update: %s, read activity: %s", async (role, canUpdate, canReadActivity) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    expect(await getDocumentDetailPermissions()).toEqual({ canUpdate, canReadActivity });
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
