import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  restoreDocumentVersionAction,
  setDocumentStatusAction,
  uploadNewDocumentVersionAction,
} from "./actions";

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(
    makeSessionUser(role, { id: getMockStore().users[0]!.id }),
  );
}

const docRow = (id: string) => getMockStore().documents.find((row) => row.id === id)!;
const versionsOf = (id: string) =>
  getMockStore().documentVersions.filter((row) => row.documentId === id);
/** A READY file of the store that is not a version yet, as a fresh upload would be. */
const readyFileId = () => getMockStore().files.find((file) => file.status === "READY")!.id;

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("setDocumentStatusAction (S6)", () => {
  it("moves a document along an allowed transition and stores it", async () => {
    asRole("MEMBER");
    const result = await setDocumentStatusAction({
      id: "doc_minuta_solaris",
      status: "EN_REVISION",
    });
    expect(result).toMatchObject({ ok: true, data: { status: "EN_REVISION" } });
    expect(docRow("doc_minuta_solaris").status).toBe("EN_REVISION");
  });

  it("refuses a transition the table does not allow with documents.errors.invalidTransition", async () => {
    asRole("MEMBER");
    const result = await setDocumentStatusAction({ id: "doc_minuta_solaris", status: "APROBADO" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { status: ["documents.errors.invalidTransition"] },
      },
    });
    expect(docRow("doc_minuta_solaris").status).toBe("BORRADOR");
  });

  it("requires the signature date for FIRMADO before the service runs", async () => {
    asRole("OWNER");
    const result = await setDocumentStatusAction({
      id: "doc_cotizacion_tornillo",
      status: "FIRMADO",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { signedAt: expect.any(Array) } },
    });
    expect(docRow("doc_cotizacion_tornillo").status).toBe("ENVIADO");
  });

  it("refuses FIRMADO on a type without signature", async () => {
    asRole("OWNER");
    const result = await setDocumentStatusAction({
      id: "doc_cotizacion_tornillo",
      status: "FIRMADO",
      signedAt: "2026-10-08",
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { status: ["documents.validation.signedStatusNotAllowed"] },
      },
    });
  });

  it("refuses a Viewer with FORBIDDEN", async () => {
    asRole("VIEWER");
    expect(
      await setDocumentStatusAction({ id: "doc_minuta_solaris", status: "EN_REVISION" }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(docRow("doc_minuta_solaris").status).toBe("BORRADOR");
  });
});

describe("restoreDocumentVersionAction (S5)", () => {
  it("creates version N+1 copying the chosen one and makes it current", async () => {
    asRole("MEMBER");
    const v1 = versionsOf("doc_prd_kairos_web").find((row) => row.versionNumber === 1)!;
    const result = await restoreDocumentVersionAction({
      documentId: "doc_prd_kairos_web",
      versionId: v1.id,
    });
    expect(result).toMatchObject({
      ok: true,
      data: { currentVersion: { versionNumber: 4, content: v1.content } },
    });
    expect(versionsOf("doc_prd_kairos_web")).toHaveLength(4);
  });

  it("is locked on a FIRMADO document (INTEGRITY_LOCK)", async () => {
    asRole("OWNER");
    const before = versionsOf("doc_contrato_kairos").length;
    const v1 = versionsOf("doc_contrato_kairos")[0]!;
    expect(
      await restoreDocumentVersionAction({ documentId: "doc_contrato_kairos", versionId: v1.id }),
    ).toMatchObject({ ok: false, error: { code: "INTEGRITY_LOCK" } });
    expect(versionsOf("doc_contrato_kairos")).toHaveLength(before);
  });

  it("refuses a Viewer with FORBIDDEN", async () => {
    asRole("VIEWER");
    const v1 = versionsOf("doc_prd_kairos_web")[0]!;
    expect(
      await restoreDocumentVersionAction({ documentId: "doc_prd_kairos_web", versionId: v1.id }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("uploadNewDocumentVersionAction (S5)", () => {
  it("adds a file version ('Subir nueva versión') with its changelog", async () => {
    asRole("MEMBER");
    const result = await uploadNewDocumentVersionAction({
      format: "ARCHIVO",
      documentId: "doc_cotizacion_tornillo",
      fileId: readyFileId(),
      changelog: "Precios ajustados",
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        currentVersion: { versionNumber: 2, format: "ARCHIVO", changelog: "Precios ajustados" },
      },
    });
  });

  it("updates a link ('Actualizar enlace') and rejects a non-http URL", async () => {
    asRole("MEMBER");
    expect(
      await uploadNewDocumentVersionAction({
        format: "ENLACE",
        documentId: "doc_credenciales_kairos",
        url: "https://vault.example.com/kairos-2",
      }),
    ).toMatchObject({
      ok: true,
      data: { currentVersion: { url: "https://vault.example.com/kairos-2" } },
    });
    expect(
      await uploadNewDocumentVersionAction({
        format: "ENLACE",
        documentId: "doc_credenciales_kairos",
        url: "javascript:alert(1)",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("blocks new versions on a FIRMADO document (INTEGRITY_LOCK)", async () => {
    asRole("OWNER");
    const before = versionsOf("doc_contrato_kairos").length;
    expect(
      await uploadNewDocumentVersionAction({
        format: "ARCHIVO",
        documentId: "doc_contrato_kairos",
        fileId: readyFileId(),
      }),
    ).toMatchObject({ ok: false, error: { code: "INTEGRITY_LOCK" } });
    expect(versionsOf("doc_contrato_kairos")).toHaveLength(before);
  });
});
