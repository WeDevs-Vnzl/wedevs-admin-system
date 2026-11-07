import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  createShareLinkAction,
  getShareableDocumentAction,
  listShareAccessLogAction,
  listShareLinksAction,
  markDocumentsSentAction,
  revokeShareLinkAction,
  setShareDocumentAccessKeyAction,
  updateShareLinkAction,
} from "./actions";
import {
  WIRE_TOKEN,
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
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createShareLinkAction", () => {
  it("creates a link from a document: pins the version, asks for a key and returns the keys once", async () => {
    const { calls } = useApi({
      "POST /api/v1/share-links": {
        status: 201,
        body: {
          share: wireShareDetail(),
          generatedKeys: [{ documentId: "doc_1", accessKey: "k3y-Only-Once-123" }],
        },
      },
    });

    const result = await createShareLinkAction({
      title: "Contract documents",
      documents: [{ documentId: "doc_1", versionId: "ver_2", requiresAccessKey: true }],
      allowDownload: true,
      locale: "es",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.share).toMatchObject({ id: "shl_1", token: WIRE_TOKEN, status: "ACTIVE" });
    expect(result.data.share.client).toEqual({
      type: "CLIENT",
      id: "cli_1",
      label: "Kairos Studio",
    });
    expect(result.data.generatedKeys).toEqual([
      { documentId: "doc_1", accessKey: "k3y-Only-Once-123" },
    ]);
    expect(calls[0]?.body).toMatchObject({
      title: "Contract documents",
      locale: "es",
      allowDownload: true,
      documents: [{ documentId: "doc_1", versionId: "ver_2", requiresAccessKey: true }],
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents/shares");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents");
  });

  it("creates a link from a client: sends the client id", async () => {
    const { calls } = useApi({
      "POST /api/v1/share-links": {
        status: 201,
        body: { share: wireShareDetail(), generatedKeys: [] },
      },
    });

    await createShareLinkAction({
      title: "Proposal",
      clientId: "cli_1",
      documents: [{ documentId: "doc_1", versionId: null, requiresAccessKey: false }],
      allowDownload: false,
      locale: "en",
      expiresAt: "2026-12-31",
      message: "Please review",
    });

    expect(calls[0]?.body).toMatchObject({
      clientId: "cli_1",
      allowDownload: false,
      locale: "en",
      expiresAt: "2026-12-31",
      message: "Please review",
    });
  });

  it("sends an explicit null for 'always the latest' and the id for a pinned version", async () => {
    const { calls } = useApi({
      "POST /api/v1/share-links": {
        status: 201,
        body: { share: wireShareDetail(), generatedKeys: [] },
      },
    });

    await createShareLinkAction({
      title: "Two documents",
      documents: [
        { documentId: "doc_1", versionId: null, requiresAccessKey: false },
        { documentId: "doc_2", versionId: "ver_9", requiresAccessKey: false },
      ],
      allowDownload: true,
      locale: "es",
    });

    const documents = (calls[0]?.body as { documents: Record<string, unknown>[] }).documents;
    expect(documents[0]).toHaveProperty("versionId", null);
    expect(documents[1]).toHaveProperty("versionId", "ver_9");
  });

  it("maps a BE refusal to field errors without touching the cache", async () => {
    useApi({
      "POST /api/v1/share-links": errorEnvelope("VALIDATION", {
        fieldErrors: { title: ["validation.required"] },
      }),
    });

    const result = await createShareLinkAction({
      title: "",
      documents: [{ documentId: "doc_1", versionId: null, requiresAccessKey: false }],
      allowDownload: true,
      locale: "es",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { title: ["validation.required"] } },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("answers FORBIDDEN for a role without the share grant (the BE decides)", async () => {
    useApi({ "POST /api/v1/share-links": errorEnvelope("FORBIDDEN") });

    const result = await createShareLinkAction({
      title: "x",
      documents: [{ documentId: "doc_1", versionId: null, requiresAccessKey: false }],
      allowDownload: true,
      locale: "es",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("updateShareLinkAction", () => {
  it("sends every field, nullable ones as null when cleared (DT-149)", async () => {
    const { calls } = useApi({
      "PATCH /api/v1/share-links/{id}": {
        body: { share: wireShareDetail(), generatedKeys: [] },
      },
    });

    await updateShareLinkAction({
      id: "shl_1",
      title: "Renamed",
      documents: [{ documentId: "doc_1", versionId: null, requiresAccessKey: false }],
      allowDownload: true,
      locale: "es",
    });

    expect(calls[0]?.path).toBe("/api/v1/share-links/shl_1");
    expect(calls[0]?.body).toEqual({
      title: "Renamed",
      message: null,
      clientId: null,
      expiresAt: null,
      locale: "es",
      allowDownload: true,
      documents: [{ documentId: "doc_1", versionId: null, requiresAccessKey: false }],
    });
  });

  it("keeps the client, the pin and the key switch of the form", async () => {
    const { calls } = useApi({
      "PATCH /api/v1/share-links/{id}": {
        body: { share: wireShareDetail(), generatedKeys: [] },
      },
    });

    await updateShareLinkAction({
      id: "shl_1",
      title: "Keep",
      clientId: "cli_1",
      message: "Hi",
      expiresAt: "2027-01-31",
      documents: [{ documentId: "doc_1", versionId: "ver_2", requiresAccessKey: true }],
      allowDownload: false,
      locale: "en",
    });

    expect(calls[0]?.body).toMatchObject({
      clientId: "cli_1",
      message: "Hi",
      expiresAt: "2027-01-31",
      allowDownload: false,
      documents: [{ documentId: "doc_1", versionId: "ver_2", requiresAccessKey: true }],
    });
  });

  it("maps the BE's 422 for an omitted field to field errors", async () => {
    useApi({
      "PATCH /api/v1/share-links/{id}": errorEnvelope("VALIDATION", {
        fieldErrors: { allowDownload: ["validation.required"] },
      }),
    });

    const result = await updateShareLinkAction({
      id: "shl_1",
      title: "t",
      documents: [{ documentId: "doc_1", versionId: null, requiresAccessKey: false }],
      allowDownload: true,
      locale: "es",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { allowDownload: ["validation.required"] } },
    });
  });
});

describe("revokeShareLinkAction", () => {
  it("revokes through POST /revoke and refreshes the pages", async () => {
    const { calls } = useApi({
      "POST /api/v1/share-links/{id}/revoke": {
        body: wireShareDetail({ status: "REVOKED", revokedAt: "2026-10-12T10:00:00.000Z" }),
      },
    });

    const result = await revokeShareLinkAction({ id: "shl_1" });

    expect(calls[0]?.path).toBe("/api/v1/share-links/shl_1/revoke");
    expect(result).toMatchObject({ ok: true, data: { status: "REVOKED" } });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents/shares");
  });
});

describe("setShareDocumentAccessKeyAction", () => {
  it("generates a key and returns it in the result only", async () => {
    const { calls } = useApi({
      "POST /api/v1/share-links/{id}/documents/{documentId}/access-key": {
        body: {
          shareLinkId: "shl_1",
          documentId: "doc_1",
          action: "generate",
          requiresAccessKey: true,
          accessKeyUpdatedAt: "2026-10-12T10:00:00.000Z",
          accessKey: "Fresh-Key-12345",
        },
      },
    });

    const result = await setShareDocumentAccessKeyAction({
      shareLinkId: "shl_1",
      documentId: "doc_1",
      action: "generate",
    });

    expect(calls[0]?.path).toBe("/api/v1/share-links/shl_1/documents/doc_1/access-key");
    expect(calls[0]?.body).toEqual({ action: "generate" });
    expect(result).toMatchObject({ ok: true, data: { accessKey: "Fresh-Key-12345" } });
    expect(JSON.stringify(cache.revalidatePath.mock.calls)).not.toContain("Fresh-Key");
  });

  it("regenerates and removes a key", async () => {
    const { calls } = useApi({
      "POST /api/v1/share-links/{id}/documents/{documentId}/access-key": (call) => {
        const action = (call.body as { action: string }).action;
        return {
          body: {
            shareLinkId: "shl_1",
            documentId: "doc_1",
            action,
            requiresAccessKey: action !== "remove",
            accessKeyUpdatedAt: action === "remove" ? null : "2026-10-12T10:00:00.000Z",
            accessKey: action === "remove" ? null : "Another-Key-678",
          },
        };
      },
    });
    const input = { shareLinkId: "shl_1", documentId: "doc_1" } as const;

    const regenerated = await setShareDocumentAccessKeyAction({ ...input, action: "regenerate" });
    const removed = await setShareDocumentAccessKeyAction({ ...input, action: "remove" });

    expect(regenerated).toMatchObject({ ok: true, data: { accessKey: "Another-Key-678" } });
    expect(removed).toMatchObject({
      ok: true,
      data: { accessKey: null, requiresAccessKey: false },
    });
    expect(calls.map((call) => (call.body as { action: string }).action)).toEqual([
      "regenerate",
      "remove",
    ]);
  });
});

describe("listShareLinksAction", () => {
  it("sends the table's filter as flat query parameters and returns the page", async () => {
    const { calls } = useApi({
      "GET /api/v1/share-links": { body: page([wireShareRow()]) },
    });

    const result = await listShareLinksAction({
      status: ["ACTIVE", "EXPIRED"],
      clientId: "cli_1",
      documentId: "doc_1",
      hasAccessKeys: true,
      sort: "viewCount:desc",
      pageSize: 50,
      q: "contract",
    });

    expect(result).toMatchObject({ ok: true, data: { total: 1 } });
    const search = calls[0]?.search;
    expect(search?.getAll("status")).toEqual(["ACTIVE", "EXPIRED"]);
    expect(search?.get("clientId")).toBe("cli_1");
    expect(search?.get("documentId")).toBe("doc_1");
    expect(search?.get("hasAccessKeys")).toBe("true");
    expect(search?.get("sort")).toBe("viewCount:desc");
    expect(search?.get("pageSize")).toBe("50");
    expect(search?.get("q")).toBe("contract");
  });

  it("answers FORBIDDEN for a Member", async () => {
    useApi({ "GET /api/v1/share-links": errorEnvelope("FORBIDDEN") });

    expect(await listShareLinksAction({})).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("listShareAccessLogAction", () => {
  it("reads the access log of one link, failed unlocks included", async () => {
    const { calls } = useApi({
      "GET /api/v1/share-links/{id}/access-log": {
        body: page([wireLogRow(), wireLogRow({ id: "sal_2", event: "VIEW", documentId: null })]),
      },
    });

    const result = await listShareAccessLogAction({
      shareLinkId: "shl_1",
      event: ["UNLOCK_FAILED", "VIEW"],
      sort: "createdAt:desc",
    });

    expect(calls[0]?.path).toBe("/api/v1/share-links/shl_1/access-log");
    expect(calls[0]?.search.getAll("event")).toEqual(["UNLOCK_FAILED", "VIEW"]);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.items.map((row) => row.event)).toEqual(["UNLOCK_FAILED", "VIEW"]);
  });
});

describe("getShareableDocumentAction", () => {
  it("returns the document with its versions newest first", async () => {
    useApi({
      "GET /api/v1/documents/{id}": { body: wireDocument("doc_1") },
      "GET /api/v1/documents/{id}/versions": { body: wireVersions("doc_1") },
    });

    const result = await getShareableDocumentAction({ id: "doc_1" });

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: "doc_1",
        code: "DOC_1",
        status: "APROBADO",
        currentVersionId: "doc_1_v2",
        versions: [
          { id: "doc_1_v3", versionNumber: 3 },
          { id: "doc_1_v2", versionNumber: 2 },
          { id: "doc_1_v1", versionNumber: 1 },
        ],
      },
    });
  });

  it("answers NOT_FOUND for an unknown or archived document", async () => {
    useApi({
      "GET /api/v1/documents/{id}": (call) =>
        call.path.endsWith("doc_gone")
          ? errorEnvelope("NOT_FOUND")
          : { body: wireDocument("doc_old", { archivedAt: "2026-10-01T00:00:00.000Z" }) },
      "GET /api/v1/documents/{id}/versions": { body: [] },
    });

    expect(await getShareableDocumentAction({ id: "doc_gone" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await getShareableDocumentAction({ id: "doc_old" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("markDocumentsSentAction", () => {
  it("moves only the APROBADO documents to ENVIADO; the rest are skipped or failed", async () => {
    const { calls } = useApi({
      "GET /api/v1/documents/{id}": (call) => {
        if (call.path.endsWith("doc_gone")) return errorEnvelope("NOT_FOUND");
        const status = call.path.endsWith("doc_draft") ? "BORRADOR" : "APROBADO";
        return { body: wireDocument(call.path.split("/").pop() ?? "", { status }) };
      },
      "POST /api/v1/documents/{id}/status": (call) =>
        call.path.includes("doc_locked")
          ? errorEnvelope("INTEGRITY_LOCK")
          : { body: wireDocument("x", { status: "ENVIADO" }) },
    });

    const result = await markDocumentsSentAction({
      documentIds: ["doc_ok", "doc_draft", "doc_gone", "doc_locked"],
    });

    expect(result).toEqual({
      ok: true,
      data: { sent: ["doc_ok"], skipped: ["doc_draft"], failed: ["doc_gone", "doc_locked"] },
    });
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts.map((call) => call.path)).toEqual([
      "/api/v1/documents/doc_ok/status",
      "/api/v1/documents/doc_locked/status",
    ]);
    expect(posts.every((call) => (call.body as { status: string }).status === "ENVIADO")).toBe(
      true,
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents");
  });

  it("surfaces a signed-out caller instead of reporting every document as failed", async () => {
    useApi({ "GET /api/v1/documents/{id}": errorEnvelope("UNAUTHENTICATED") });

    expect(await markDocumentsSentAction({ documentIds: ["doc_ok"] })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});
