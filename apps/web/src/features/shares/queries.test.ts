import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/mocks/session", () => session);
vi.mock("@/lib/api/server", () => server);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { makeSessionUser } from "@/mocks/test-helpers";
import { ServiceError } from "@/server/errors";
import {
  getShareLink,
  getShareableDocuments,
  getSharePermissions,
  listShareAccessLog,
  listShareLinks,
  shareableDocumentOf,
} from "./queries";
import {
  page,
  wireDocument,
  wireLogRow,
  wireShareDetail,
  wireShareRow,
  wireVersions,
} from "./test-fixtures";

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
});

describe("getSharePermissions", () => {
  it("grants links to Owner and Admin only", async () => {
    expect(await getSharePermissions()).toEqual({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canUpdateDocuments: true,
    });
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    expect(await getSharePermissions()).toEqual({
      canRead: false,
      canCreate: false,
      canUpdate: false,
      canUpdateDocuments: true,
    });
  });
});

describe("share link reads", () => {
  it("lists the links through GET /share-links with the document filter of the tab", async () => {
    const { calls } = useApi({ "GET /api/v1/share-links": { body: page([wireShareRow()]) } });

    const result = await listShareLinks({
      documentId: "doc_1",
      pageSize: 100,
      sort: "createdAt:desc",
    });

    expect(result.items[0]).toMatchObject({
      id: "shl_1",
      status: "ACTIVE",
      expiresAt: "2026-12-31",
    });
    expect(result.items[0]?.client).toEqual({
      type: "CLIENT",
      id: "cli_1",
      label: "Kairos Studio",
    });
    expect(calls[0]?.search.get("documentId")).toBe("doc_1");
    expect(calls[0]?.search.get("pageSize")).toBe("100");
    expect(calls[0]?.search.get("sort")).toBe("createdAt:desc");
  });

  it("reads one link with its counters, last access and document pins as returned", async () => {
    useApi({
      "GET /api/v1/share-links/{id}": {
        body: wireShareDetail({ lastAccessedAt: "2026-10-10T15:00:00.000Z", status: "EXPIRED" }),
      },
    });

    const share = await getShareLink("shl_1");

    expect(share).toMatchObject({
      status: "EXPIRED",
      lastAccessedAt: "2026-10-10T15:00:00.000Z",
      counters: { viewCount: 12, failedUnlockCount: 3 },
    });
    expect(share.documents[0]).toMatchObject({ versionId: "ver_2", requiresAccessKey: true });
    expect(share.documents[0]?.document.code).toBe("DOC-1");
  });

  it("throws the mock-era ServiceError the page and the loader catch", async () => {
    useApi({
      "GET /api/v1/share-links/{id}": (call) =>
        call.path.endsWith("shl_gone") ? errorEnvelope("NOT_FOUND") : errorEnvelope("FORBIDDEN"),
    });

    await expect(getShareLink("shl_gone")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getShareLink("shl_other")).rejects.toBeInstanceOf(ServiceError);
    await expect(getShareLink("shl_other")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails a page on an unexpected BE error", async () => {
    useApi({ "GET /api/v1/share-links": errorEnvelope("INTERNAL") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(listShareLinks()).rejects.toThrow("failed with 500");
  });

  it("reads the access log of a link, failed unlocks included", async () => {
    const { calls } = useApi({
      "GET /api/v1/share-links/{id}/access-log": { body: page([wireLogRow()]) },
    });

    const result = await listShareAccessLog({ shareLinkId: "shl_1", sort: "createdAt:desc" });

    expect(calls[0]?.path).toBe("/api/v1/share-links/shl_1/access-log");
    expect(result.items[0]).toMatchObject({ event: "UNLOCK_FAILED", visitor: "a1b2c3d4" });
  });
});

describe("getShareableDocuments", () => {
  it("keeps the order and leaves out unknown, archived and malformed ids", async () => {
    const { calls } = useApi({
      "GET /api/v1/documents/{id}": (call) => {
        const id = call.path.split("/").pop() ?? "";
        if (id === "doc_missing") return errorEnvelope("NOT_FOUND");
        return {
          body: wireDocument(id, {
            archivedAt: id === "doc_archived" ? "2026-10-01T00:00:00.000Z" : null,
            currentVersion: id === "doc_b" ? null : { id: `${id}_v2`, versionNumber: 2 },
          }),
        };
      },
      "GET /api/v1/documents/{id}/versions": (call) => ({
        body: wireVersions(call.path.split("/")[4] ?? ""),
      }),
    });

    const result = await getShareableDocuments([
      "doc_b",
      "doc_missing",
      "bad id!",
      "doc_archived",
      "doc_a",
    ]);

    expect(result.map((doc) => doc.id)).toEqual(["doc_b", "doc_a"]);
    expect(result[0]).toMatchObject({ currentVersionId: null });
    expect(result[1]?.versions.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
    // two reads per linked document (detail + versions); an archived one stops after the detail
    const reads = (suffix: RegExp) => calls.filter((call) => suffix.test(call.path)).length;
    expect(reads(/\/documents\/[^/]+$/)).toBe(4);
    expect(reads(/\/versions$/)).toBe(2);
  });

  it("fails on an unexpected BE error instead of hiding the document", async () => {
    useApi({ "GET /api/v1/documents/{id}": errorEnvelope("INTERNAL") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getShareableDocuments(["doc_a"])).rejects.toThrow();
  });
});

describe("shareableDocumentOf", () => {
  it("returns null for an archived document and throws NOT_FOUND for an unknown one", async () => {
    useApi({
      "GET /api/v1/documents/{id}": (call) =>
        call.path.endsWith("doc_gone")
          ? errorEnvelope("NOT_FOUND")
          : { body: wireDocument("doc_old", { archivedAt: "2026-10-01T00:00:00.000Z" }) },
    });

    expect(await shareableDocumentOf("doc_old")).toBeNull();
    await expect(shareableDocumentOf("doc_gone")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
