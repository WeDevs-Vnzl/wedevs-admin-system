import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  archiveDocumentAction,
  archiveDocumentsAction,
  createDocumentAction,
  linkDocumentAction,
  listDocumentsAction,
  publishDocumentVersionAction,
  restoreDocumentAction,
  restoreDocumentVersionAction,
  saveDocumentDraftAction,
  searchDocumentsAction,
  setDocumentStatusAction,
  unlinkDocumentAction,
  updateDocumentMetaAction,
  uploadNewDocumentVersionAction,
} from "./actions";
import { wireDetail, wirePage, wireRow } from "./wire-fixtures";

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

const clientTarget = { entityType: "CLIENT", entityId: "cli_1" } as const;
const meta = {
  title: "Anexo técnico",
  typeId: "dtype_contract",
  alertDaysBefore: 30,
  tagIds: [],
};

beforeEach(() => {
  cache.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDocumentAction (HU-18)", () => {
  it("creates the document with its first file version in one call (initialVersion)", async () => {
    const { calls } = useApi({
      "POST /api/v1/documents": { status: 201, body: wireDetail({ title: "Anexo técnico" }) },
    });
    const result = await createDocumentAction({
      ...meta,
      links: [clientTarget],
      initialVersion: { format: "ARCHIVO", fileId: "fil_1", changelog: "Primera" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      ...meta,
      links: [clientTarget],
      initialVersion: { format: "ARCHIVO", fileId: "fil_1", changelog: "Primera" },
    });
    expect(result).toMatchObject({ ok: true, data: { id: "doc_1" } });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients/cli_1");
  });

  it("sends a link as the first version and a version-less document without initialVersion", async () => {
    const { calls } = useApi({ "POST /api/v1/documents": { status: 201, body: wireDetail() } });
    await createDocumentAction({
      ...meta,
      links: [],
      initialVersion: { format: "ENLACE", url: "https://example.com/doc" },
    });
    expect(calls[0]?.body).toMatchObject({
      initialVersion: { format: "ENLACE", url: "https://example.com/doc" },
    });
    await createDocumentAction({ ...meta, links: [] });
    expect(calls[1]?.body).not.toHaveProperty("initialVersion");
  });

  it("maps a Viewer's 403, a file that is not ready (404) and a held file (409)", async () => {
    useApi({ "POST /api/v1/documents": errorEnvelope("FORBIDDEN") });
    expect(await createDocumentAction({ ...meta, links: [] })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    useApi({ "POST /api/v1/documents": errorEnvelope("NOT_FOUND") });
    expect(await createDocumentAction({ ...meta, links: [] })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    // DT-136: a file already held by a version is refused.
    useApi({ "POST /api/v1/documents": errorEnvelope("CONFLICT") });
    expect(await createDocumentAction({ ...meta, links: [] })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });

  it("shows the BE's field errors", async () => {
    useApi({
      "POST /api/v1/documents": errorEnvelope("VALIDATION", {
        fieldErrors: { expiresAt: ["documents.validation.expiresAtNotAllowed"] },
      }),
    });
    const result = await createDocumentAction({ ...meta, links: [] });
    expect(result).toMatchObject({
      ok: false,
      error: { fieldErrors: { expiresAt: ["documents.validation.expiresAtNotAllowed"] } },
    });
  });
});

describe("updateDocumentMetaAction", () => {
  it("patches the metadata without the id in the body", async () => {
    const { calls } = useApi({ "PATCH /api/v1/documents/{id}": { body: wireDetail() } });
    const result = await updateDocumentMetaAction({ ...meta, id: "doc_1", summary: "Nuevo" });
    expect(calls[0]?.path).toBe("/api/v1/documents/doc_1");
    expect(calls[0]?.body).toEqual({
      ...meta,
      summary: "Nuevo",
      effectiveDate: null,
      signedAt: null,
      expiresAt: null,
    });
    expect(result.ok).toBe(true);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents");
  });
});

describe("link and unlink actions (HU-20 CA2)", () => {
  it("links one record and returns the links with their chips parsed", async () => {
    const { calls } = useApi({
      "POST /api/v1/documents/{id}/links": {
        status: 201,
        body: wireDetail().links,
      },
    });
    const result = await linkDocumentAction({ documentId: "doc_1", target: clientTarget });
    expect(calls[0]?.path).toBe("/api/v1/documents/doc_1/links");
    expect(calls[0]?.body).toEqual(clientTarget);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.data[0]?.entity).toEqual({
      type: "CLIENT",
      id: "cli_1",
      label: "Kairos",
    });
  });

  it("unlinks one record through DELETE and keeps the document's other links", async () => {
    const { calls } = useApi({
      "DELETE /api/v1/documents/{id}/links/{entityType}/{entityId}": {
        body: [
          {
            id: "lnk_2",
            createdAt: "2026-01-01T00:00:00.000Z",
            entity: { type: "PROJECT", id: "pry_1", label: "Web", code: "PRY-1" },
          },
        ],
      },
    });
    const result = await unlinkDocumentAction({ documentId: "doc_1", target: clientTarget });
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.path).toBe("/api/v1/documents/doc_1/links/CLIENT/cli_1");
    expect(result.ok && result.data.map((link) => link.entity.id)).toEqual(["pry_1"]);
  });

  it("answers NOT_FOUND for a target the caller cannot read (DT-142) and FORBIDDEN for a Viewer", async () => {
    useApi({ "POST /api/v1/documents/{id}/links": errorEnvelope("NOT_FOUND") });
    expect(await linkDocumentAction({ documentId: "doc_1", target: clientTarget })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    useApi({
      "DELETE /api/v1/documents/{id}/links/{entityType}/{entityId}": errorEnvelope("FORBIDDEN"),
    });
    expect(await unlinkDocumentAction({ documentId: "doc_1", target: clientTarget })).toMatchObject(
      { ok: false, error: { code: "FORBIDDEN" } },
    );
  });
});

describe("searchDocumentsAction (frozen, rule 12)", () => {
  it("lists with q and pageSize 25, archived not requested, and keeps the first 20 as EntityRef", async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      wireRow({ id: `doc_${index}`, code: `DOC-${index}`, title: `Doc ${index}` }),
    );
    const { calls } = useApi({ "GET /api/v1/documents": { body: wirePage(rows, 25) } });
    const result = await searchDocumentsAction({ q: "doc" });
    expect(calls[0]?.search.get("q")).toBe("doc");
    expect(calls[0]?.search.get("pageSize")).toBe("25");
    expect(calls[0]?.search.get("archived")).not.toBe("include");
    expect(calls[0]?.search.get("archived")).not.toBe("only");
    expect(result.ok && result.data).toHaveLength(20);
    expect(result.ok && result.data[0]).toEqual({
      type: "DOCUMENT",
      id: "doc_0",
      code: "DOC-0",
      label: "Doc 0",
    });
  });

  it("answers the BE's error (a signed-out caller)", async () => {
    useApi({ "GET /api/v1/documents": errorEnvelope("UNAUTHENTICATED") });
    expect(await searchDocumentsAction({ q: "x" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("listDocumentsAction", () => {
  it("returns one page with the table facets applied", async () => {
    const { calls } = useApi({ "GET /api/v1/documents": { body: wirePage([wireRow()]) } });
    const result = await listDocumentsAction({ status: ["APROBADO"], clientId: ["cli_1"] });
    expect(calls[0]?.search.getAll("status")).toEqual(["APROBADO"]);
    expect(calls[0]?.search.getAll("clientId")).toEqual(["cli_1"]);
    expect(result.ok && result.data.items[0]?.id).toBe("doc_1");
  });

  it("refuses a malformed filter before any call", async () => {
    const { calls } = useApi({});
    const result = await listDocumentsAction({ status: ["NOPE"] } as never);
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(calls).toHaveLength(0);
  });
});

describe("status, versions and drafts (HU-18 CA1-CA2)", () => {
  it("moves a document along a transition; FIRMADO carries its signature date", async () => {
    const { calls } = useApi({
      "POST /api/v1/documents/{id}/status": { body: wireDetail({ status: "FIRMADO" }) },
    });
    const result = await setDocumentStatusAction({
      id: "doc_1",
      status: "FIRMADO",
      signedAt: "2026-02-01",
    });
    expect(calls[0]?.body).toEqual({ status: "FIRMADO", signedAt: "2026-02-01" });
    expect(result).toMatchObject({ ok: true, data: { status: "FIRMADO" } });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents/list");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents/doc_1", "layout");
  });

  it("maps a transition the BE refuses to its message key", async () => {
    useApi({
      "POST /api/v1/documents/{id}/status": errorEnvelope("CONFLICT", {
        message: "documents.errors.invalidTransition",
      }),
    });
    expect(await setDocumentStatusAction({ id: "doc_1", status: "APROBADO" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "documents.errors.invalidTransition" },
    });
  });

  it("saves the draft explicitly (PUT), creating no version", async () => {
    const { calls } = useApi({
      "PUT /api/v1/documents/{id}/draft": {
        body: { documentId: "doc_1", draftUpdatedAt: "2026-02-01T10:00:00.000Z" },
      },
    });
    const result = await saveDocumentDraftAction({ documentId: "doc_1", content: "# Borrador" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toEqual({ content: "# Borrador" });
    expect(result).toMatchObject({
      ok: true,
      data: { documentId: "doc_1", draftUpdatedAt: "2026-02-01T10:00:00.000Z" },
    });
  });

  it("publishes version N+1 after a saved draft, with the latest text and the changelog", async () => {
    const { calls } = useApi({
      "PUT /api/v1/documents/{id}/draft": {
        body: { documentId: "doc_1", draftUpdatedAt: "2026-02-01T10:00:00.000Z" },
      },
      "POST /api/v1/documents/{id}/versions/publish": {
        status: 201,
        body: wireDetail({
          versionCount: 3,
          currentVersion: {
            ...wireDetail().currentVersion,
            id: "ver_3",
            versionNumber: 3,
            format: "MARKDOWN",
            file: null,
            content: "# V3",
            changelog: "Ajustes",
          },
        }),
      },
    });
    await saveDocumentDraftAction({ documentId: "doc_1", content: "# V3" });
    const result = await publishDocumentVersionAction({
      documentId: "doc_1",
      content: "# V3",
      changelog: "Ajustes",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "PUT /api/v1/documents/doc_1/draft",
      "POST /api/v1/documents/doc_1/versions/publish",
    ]);
    expect(calls[1]?.body).toEqual({ content: "# V3", changelog: "Ajustes" });
    expect(result).toMatchObject({
      ok: true,
      data: { versionCount: 3, currentVersion: { versionNumber: 3 } },
    });
  });

  it("maps the signed-document lock to INTEGRITY_LOCK on draft and publish", async () => {
    useApi({
      "PUT /api/v1/documents/{id}/draft": errorEnvelope("INTEGRITY_LOCK"),
      "POST /api/v1/documents/{id}/versions/publish": errorEnvelope("INTEGRITY_LOCK"),
    });
    expect(await saveDocumentDraftAction({ documentId: "doc_1", content: "x" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK" },
    });
    expect(await publishDocumentVersionAction({ documentId: "doc_1", content: "x" })).toMatchObject(
      { ok: false, error: { code: "INTEGRITY_LOCK" } },
    );
  });

  it("shows the BE's field error for a changelog over the limit", async () => {
    useApi({
      "POST /api/v1/documents/{id}/versions/publish": errorEnvelope("VALIDATION", {
        fieldErrors: { changelog: ["validation.tooLong"] },
      }),
    });
    expect(
      await publishDocumentVersionAction({ documentId: "doc_1", changelog: "x" }),
    ).toMatchObject({ ok: false, error: { fieldErrors: { changelog: ["validation.tooLong"] } } });
  });

  it("restores a version as N+1 (POST .../restore) and refuses it on a signed document", async () => {
    const { calls } = useApi({
      "POST /api/v1/documents/{id}/versions/{versionId}/restore": {
        status: 201,
        body: wireDetail({ versionCount: 3 }),
      },
    });
    const result = await restoreDocumentVersionAction({
      documentId: "doc_1",
      versionId: "ver_1",
      changelog: "Vuelta",
    });
    expect(calls[0]?.path).toBe("/api/v1/documents/doc_1/versions/ver_1/restore");
    expect(calls[0]?.body).toEqual({ changelog: "Vuelta" });
    expect(result).toMatchObject({ ok: true, data: { versionCount: 3 } });

    useApi({
      "POST /api/v1/documents/{id}/versions/{versionId}/restore": errorEnvelope("INTEGRITY_LOCK"),
    });
    expect(
      await restoreDocumentVersionAction({ documentId: "doc_1", versionId: "ver_1" }),
    ).toMatchObject({ ok: false, error: { code: "INTEGRITY_LOCK" } });
  });

  it("uploads a file version and a link version, and maps the signed lock", async () => {
    const { calls } = useApi({
      "POST /api/v1/documents/{id}/versions": { status: 201, body: wireDetail() },
    });
    await uploadNewDocumentVersionAction({
      format: "ARCHIVO",
      documentId: "doc_1",
      fileId: "fil_2",
      changelog: "Nueva",
    });
    await uploadNewDocumentVersionAction({
      format: "ENLACE",
      documentId: "doc_1",
      url: "https://example.com/v2",
    });
    expect(calls[0]?.body).toEqual({ format: "ARCHIVO", fileId: "fil_2", changelog: "Nueva" });
    expect(calls[1]?.body).toEqual({ format: "ENLACE", url: "https://example.com/v2" });

    // A FIRMADO (or signed VENCIDO) document refuses new versions: DT-138.
    useApi({ "POST /api/v1/documents/{id}/versions": errorEnvelope("INTEGRITY_LOCK") });
    expect(
      await uploadNewDocumentVersionAction({
        format: "ARCHIVO",
        documentId: "doc_1",
        fileId: "fil_3",
      }),
    ).toMatchObject({ ok: false, error: { code: "INTEGRITY_LOCK" } });
  });

  it("maps a file already held by a version (DT-136) to CONFLICT", async () => {
    useApi({ "POST /api/v1/documents/{id}/versions": errorEnvelope("CONFLICT") });
    expect(
      await uploadNewDocumentVersionAction({
        format: "ARCHIVO",
        documentId: "doc_1",
        fileId: "fil_held",
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });
});

describe("archive and restore", () => {
  it("archives one document and revalidates the lists", async () => {
    const { calls } = useApi({
      "POST /api/v1/documents/{id}/archive": {
        body: { id: "doc_1", archivedAt: "2026-02-01T00:00:00.000Z" },
      },
    });
    const result = await archiveDocumentAction({ id: "doc_1" });
    expect(calls[0]?.path).toBe("/api/v1/documents/doc_1/archive");
    expect(result).toMatchObject({ ok: true, data: { id: "doc_1" } });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/documents");
  });

  it("archives several in one call, all or nothing", async () => {
    const { calls } = useApi({
      "POST /api/v1/documents/archive": {
        body: { archived: [{ id: "doc_1", archivedAt: "2026-02-01T00:00:00.000Z" }] },
      },
    });
    const ok = await archiveDocumentsAction({ ids: ["doc_1"] });
    expect(calls[0]?.body).toEqual({ ids: ["doc_1"] });
    expect(ok).toMatchObject({ ok: true, data: { archived: [{ id: "doc_1" }] } });

    useApi({ "POST /api/v1/documents/archive": errorEnvelope("NOT_FOUND") });
    expect(await archiveDocumentsAction({ ids: ["doc_1", "doc_x"] })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("restores an archived document (trash roles)", async () => {
    const { calls } = useApi({
      "POST /api/v1/documents/{id}/restore": {
        body: { id: "doc_1", code: "DOC-0001", label: "Contrato", type: "DOCUMENT" },
      },
    });
    const result = await restoreDocumentAction({ id: "doc_1" });
    expect(calls[0]?.path).toBe("/api/v1/documents/doc_1/restore");
    expect(result).toMatchObject({ ok: true, data: { id: "doc_1" } });
  });
});
