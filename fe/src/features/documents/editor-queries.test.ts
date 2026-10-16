import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { getDocumentEditor } from "./editor-queries";

const storedUserId = () => getMockStore().users[0]!.id;

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: storedUserId() }));
}

const formatOf = (versionId: string | null) =>
  getMockStore().documentVersions.find((version) => version.id === versionId)?.format;

function findDocument(
  predicate: (row: ReturnType<typeof getMockStore>["documents"][number]) => boolean,
) {
  return getMockStore().documents.find((row) => row.archivedAt === null && predicate(row))!;
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  asRole("MEMBER");
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("getDocumentEditor", () => {
  it("opens an unsigned markdown document for editing, starting from its draft", async () => {
    const doc = findDocument(
      (row) => row.status !== "FIRMADO" && formatOf(row.currentVersionId) === "MARKDOWN",
    );
    doc.draftContent = "# Pending draft";
    const editor = await getDocumentEditor(doc.id);
    expect(editor).toMatchObject({
      availability: "editable",
      content: "# Pending draft",
      document: { id: doc.id },
    });
  });

  it("starts from the current version when there is no draft", async () => {
    const doc = findDocument(
      (row) => row.status !== "FIRMADO" && formatOf(row.currentVersionId) === "MARKDOWN",
    );
    doc.draftContent = null;
    const editor = await getDocumentEditor(doc.id);
    expect(editor?.content).toBe(editor?.document.currentVersion?.content);
    expect(editor?.content).toBeTruthy();
  });

  it("reports a signed document as locked", async () => {
    const doc = findDocument((row) => formatOf(row.currentVersionId) === "MARKDOWN");
    doc.status = "FIRMADO";
    expect(await getDocumentEditor(doc.id)).toMatchObject({ availability: "signed" });
  });

  it("reports a file or link document as not editable in markdown", async () => {
    const doc = findDocument(
      (row) => row.status !== "FIRMADO" && formatOf(row.currentVersionId) === "ARCHIVO",
    );
    expect(await getDocumentEditor(doc.id)).toMatchObject({ availability: "notMarkdown" });
  });

  it("answers null to a Viewer, an unknown id, a malformed id and an archived document", async () => {
    const doc = findDocument((row) => formatOf(row.currentVersionId) === "MARKDOWN");
    asRole("VIEWER");
    expect(await getDocumentEditor(doc.id)).toBeNull();
    asRole("MEMBER");
    expect(await getDocumentEditor("doc_does_not_exist")).toBeNull();
    expect(await getDocumentEditor("")).toBeNull();
    doc.archivedAt = new Date().toISOString();
    expect(await getDocumentEditor(doc.id)).toBeNull();
  });
});
