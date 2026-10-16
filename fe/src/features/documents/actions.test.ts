import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

// `updateDocumentMeta` of the documents service is stubbed (its mock implementation is another task); every
// other service function stays the real one over the mock store.
const service = vi.hoisted(() => ({ updateDocumentMeta: vi.fn() }));
vi.mock("@/mocks/services/documents", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...service,
}));

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  createDocumentAction,
  linkDocumentAction,
  listDocumentsAction,
  searchDocumentsAction,
  unlinkDocumentAction,
  updateDocumentMetaAction,
  uploadDocumentVersionAction,
} from "./actions";

/** A stored user, so the document's author resolves in the store. */
const storedUserId = () => getMockStore().users[0]!.id;

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: storedUserId() }));
}

function clientTarget() {
  const client = getMockStore().clients[0]!;
  return { entityType: "CLIENT" as const, entityId: client.id };
}

function draftInput() {
  const store = getMockStore();
  const type = store.documentTypes.find((row) => row.active && row.defaultFormat === "ARCHIVO")!;
  return {
    title: "Anexo técnico",
    typeId: type.id,
    alertDaysBefore: 30,
    tagIds: [],
    links: [clientTarget()],
  };
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  service.updateDocumentMeta.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("createDocumentAction", () => {
  it("lets Owner, Admin and Member create a document linked to the record", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      asRole(role);
      const result = await createDocumentAction(draftInput());
      expect(result).toMatchObject({
        ok: true,
        data: { status: "BORRADOR", title: "Anexo técnico" },
      });
    }
  });

  it("refuses a Viewer with FORBIDDEN and creates nothing", async () => {
    asRole("VIEWER");
    const before = getMockStore().documents.length;
    expect(await createDocumentAction(draftInput())).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(getMockStore().documents).toHaveLength(before);
  });

  it("requires a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await createDocumentAction(draftInput())).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("validates the input before the service runs", async () => {
    asRole("MEMBER");
    expect(await createDocumentAction({ ...draftInput(), title: "" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});

describe("link and unlink actions", () => {
  it("let a Member link and unlink, and refuse a Viewer", async () => {
    asRole("MEMBER");
    const doc = getMockStore().documents.find((row) => row.archivedAt === null)!;
    const target = { entityType: "PROJECT" as const, entityId: getMockStore().projects[0]!.id };
    expect(await linkDocumentAction({ documentId: doc.id, target })).toMatchObject({ ok: true });
    expect(await unlinkDocumentAction({ documentId: doc.id, target })).toMatchObject({ ok: true });

    asRole("VIEWER");
    expect(await linkDocumentAction({ documentId: doc.id, target })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await unlinkDocumentAction({ documentId: doc.id, target })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("keep the document's other links when one is removed", async () => {
    asRole("MEMBER");
    const store = getMockStore();
    const doc = store.documents.find((row) => row.archivedAt === null)!;
    const projectTarget = { entityType: "PROJECT" as const, entityId: store.projects[0]!.id };
    await linkDocumentAction({ documentId: doc.id, target: projectTarget });
    const result = await unlinkDocumentAction({ documentId: doc.id, target: projectTarget });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.data.some((link) => link.entity.id === projectTarget.entityId)).toBe(false);
    expect(store.documents.find((row) => row.id === doc.id)?.archivedAt).toBeNull();
  });
});

describe("uploadDocumentVersionAction", () => {
  it("refuses a Viewer", async () => {
    asRole("VIEWER");
    const doc = getMockStore().documents.find((row) => row.archivedAt === null)!;
    const file = getMockStore().files.find((row) => row.status === "READY")!;
    expect(
      await uploadDocumentVersionAction({ documentId: doc.id, format: "ARCHIVO", fileId: file.id }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("searchDocumentsAction", () => {
  it("answers every signed-in role, Viewer included, with the documents matching q", async () => {
    asRole("VIEWER");
    const doc = getMockStore().documents.find((row) => row.archivedAt === null)!;
    const result = await searchDocumentsAction({ q: doc.code });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((row) => row.id)).toContain(doc.id);
  });

  it("answers EntityRef options: code, title as label, type DOCUMENT, at most 20", async () => {
    asRole("MEMBER");
    const doc = getMockStore().documents.find((row) => row.archivedAt === null)!;
    const result = await searchDocumentsAction({ q: doc.code });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.find((row) => row.id === doc.id)).toEqual({
      id: doc.id,
      code: doc.code,
      label: doc.title,
      type: "DOCUMENT",
    });
    const all = await searchDocumentsAction({ q: "" });
    expect(all.ok && all.data.length).toBeLessThanOrEqual(20);
  });

  it("requires a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await searchDocumentsAction({ q: "DOC" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("listDocumentsAction", () => {
  it("answers every signed-in role, Viewer included, with one page of documents", async () => {
    asRole("VIEWER");
    const result = await listDocumentsAction({ pageSize: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.pageSize).toBe(25);
    expect(result.data.items.length).toBeGreaterThan(0);
  });

  it("applies the table facets of the filter", async () => {
    asRole("MEMBER");
    const doc = getMockStore().documents.find((row) => row.archivedAt === null)!;
    const result = await listDocumentsAction({ status: [doc.status] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.items.every((row) => row.status === doc.status)).toBe(true);
  });

  it("validates the filter and requires a session", async () => {
    asRole("MEMBER");
    expect(await listDocumentsAction({ status: ["NOPE"] } as never)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await listDocumentsAction({})).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("updateDocumentMetaAction", () => {
  function metaInput() {
    const { typeId, alertDaysBefore, tagIds } = draftInput();
    return {
      id: getMockStore().documents[0]!.id,
      typeId,
      alertDaysBefore,
      tagIds,
      title: "Contrato marco",
    };
  }

  it("lets Owner, Admin and Member update the metadata through the service", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      asRole(role);
      service.updateDocumentMeta.mockResolvedValueOnce({ id: metaInput().id });
      expect(await updateDocumentMetaAction(metaInput())).toMatchObject({ ok: true });
    }
    expect(service.updateDocumentMeta).toHaveBeenCalledTimes(3);
    expect(service.updateDocumentMeta).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: metaInput().id, title: "Contrato marco" }),
    );
  });

  it("refuses a Viewer with FORBIDDEN without calling the service", async () => {
    asRole("VIEWER");
    expect(await updateDocumentMetaAction(metaInput())).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(service.updateDocumentMeta).not.toHaveBeenCalled();
  });

  it("validates the input before the service runs", async () => {
    asRole("MEMBER");
    expect(await updateDocumentMetaAction({ ...metaInput(), title: "" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(service.updateDocumentMeta).not.toHaveBeenCalled();
  });
});
