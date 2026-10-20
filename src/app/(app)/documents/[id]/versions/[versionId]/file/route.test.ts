import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { GET } from "./route";

function get(id: string, versionId: string, query = "") {
  return GET(new Request(`http://localhost/documents/${id}/versions/${versionId}/file${query}`), {
    params: Promise.resolve({ id, versionId }),
  });
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(
    makeSessionUser("VIEWER", { id: getMockStore().users[0]!.id }),
  );
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("GET /documents/[id]/versions/[versionId]/file", () => {
  it("serves a real PDF inline for a PDF file version, never cached", async () => {
    const response = await get("doc_contrato_kairos", "dver_contrato_kairos_2");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename=/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const text = new TextDecoder("latin1").decode(await response.arrayBuffer());
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Page");
  });

  it("downloads as an attachment with the stored file name", async () => {
    const response = await get("doc_contrato_kairos", "dver_contrato_kairos_2", "?download=1");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="contrato-kairos-firmado.pdf"; filename*=UTF-8''contrato-kairos-firmado.pdf`,
    );
  });

  it("serves a markdown version as a sandboxed .md", async () => {
    const response = await get("doc_prd_kairos_web", "dver_prd_kairos_web_1", "?download=1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("content-disposition")).toMatch(/filename="DOC-\d{4}-v1\.md"/);
    const version = getMockStore().documentVersions.find((v) => v.id === "dver_prd_kairos_web_1")!;
    expect(await response.text()).toBe(version.content);
  });

  it("redirects a link version to its URL", async () => {
    const doc = getMockStore().documents.find((row) => row.id === "doc_credenciales_kairos")!;
    const version = getMockStore().documentVersions.find((v) => v.id === doc.currentVersionId)!;
    const response = await get(doc.id, version.id);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(version.url);
  });

  it("answers 404 for an unknown version, a version of another document or a malformed id", async () => {
    expect((await get("doc_prd_kairos_web", "dver_nope")).status).toBe(404);
    expect((await get("doc_prd_kairos_web", "dver_contrato_kairos_1")).status).toBe(404);
    expect((await get("doc prd", "dver_prd_kairos_web_1")).status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect((await get("doc_contrato_kairos", "dver_contrato_kairos_2")).status).toBe(401);
  });
});
