import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  getDocumentDetailPermissions,
  listDocumentVersions,
  readDocumentDetail,
  readDocumentVersion,
  readVersionFile,
} from "./queries";

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(
    makeSessionUser(role, { id: getMockStore().users[0]!.id }),
  );
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("readDocumentDetail", () => {
  it("reads a document with its current version", async () => {
    asRole("VIEWER");
    const doc = await readDocumentDetail("doc_prd_kairos_web");
    expect(doc).toMatchObject({
      id: "doc_prd_kairos_web",
      status: "APROBADO",
      currentVersion: { format: "MARKDOWN", versionNumber: 3 },
    });
  });

  it("answers null for an unknown or malformed id, so the page can 404", async () => {
    asRole("OWNER");
    expect(await readDocumentDetail("doc_missing")).toBeNull();
    expect(await readDocumentDetail("../etc/passwd")).toBeNull();
  });

  it("hides an archived document from a role without the trash grant", async () => {
    const store = getMockStore();
    store.documents.find((row) => row.id === "doc_prd_kairos_web")!.archivedAt =
      "2026-10-01T00:00:00.000Z";
    asRole("MEMBER");
    expect(await readDocumentDetail("doc_prd_kairos_web")).toBeNull();
  });
});

describe("versions", () => {
  it("lists the history newest first, without content, flagging the current one", async () => {
    asRole("VIEWER");
    const versions = await listDocumentVersions("doc_prd_kairos_web");
    expect(versions.map((row) => row.versionNumber)).toEqual([3, 2, 1]);
    expect(versions[0]).toMatchObject({ isCurrent: true, createdBy: { name: expect.any(String) } });
    expect(versions[0]).not.toHaveProperty("content");
  });

  it("reads one version with its content, and null for a version of another document", async () => {
    asRole("VIEWER");
    const version = await readDocumentVersion("doc_prd_kairos_web", "dver_prd_kairos_web_1");
    expect(version).toMatchObject({ versionNumber: 1, isCurrent: false });
    expect(version?.content).toEqual(expect.any(String));
    expect(await readDocumentVersion("doc_prd_kairos_web", "dver_contrato_kairos_1")).toBeNull();
  });
});

describe("getDocumentDetailPermissions", () => {
  it.each([
    ["OWNER", true, true],
    ["ADMIN", true, true],
    ["MEMBER", true, false],
    ["VIEWER", false, false],
  ] as const)("%s: update %s, activity %s", async (role, canUpdate, canReadActivity) => {
    asRole(role);
    expect(await getDocumentDetailPermissions()).toEqual({ canUpdate, canReadActivity });
  });
});

describe("readVersionFile", () => {
  it("describes a PDF file version by its stored name and the document title", async () => {
    asRole("VIEWER");
    expect(await readVersionFile("doc_contrato_kairos", "dver_contrato_kairos_2")).toEqual({
      kind: "pdf",
      fileName: "contrato-kairos-firmado.pdf",
      title: expect.any(String),
      versionNumber: 2,
    });
  });

  it("serves a markdown version as a .md named after the code and version", async () => {
    asRole("VIEWER");
    const file = await readVersionFile("doc_prd_kairos_web", "dver_prd_kairos_web_2");
    expect(file).toMatchObject({ kind: "markdown", content: expect.any(String) });
    expect(file && "fileName" in file ? file.fileName : "").toMatch(/^DOC-\d{4}-v2\.md$/);
  });

  it("points a link version to its URL", async () => {
    asRole("VIEWER");
    const doc = await readDocumentDetail("doc_credenciales_kairos");
    const version = doc!.currentVersion!;
    expect(await readVersionFile(doc!.id, version.id)).toEqual({
      kind: "external",
      url: version.url,
    });
  });

  it("answers null for an unknown version or a malformed id", async () => {
    asRole("VIEWER");
    expect(await readVersionFile("doc_prd_kairos_web", "dver_nope")).toBeNull();
    expect(await readVersionFile("doc prd", "dver_prd_kairos_web_1")).toBeNull();
  });
});
