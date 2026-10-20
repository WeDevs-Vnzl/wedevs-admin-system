import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { publishDocumentVersionAction, saveDocumentDraftAction } from "./actions";

const storedUserId = () => getMockStore().users[0]!.id;

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: storedUserId() }));
}

/** An active markdown document that is not signed. */
function markdownDocument() {
  const store = getMockStore();
  return store.documents.find(
    (row) =>
      row.archivedAt === null &&
      row.status !== "FIRMADO" &&
      store.documentVersions.find((version) => version.id === row.currentVersionId)?.format ===
        "MARKDOWN",
  )!;
}

function signedDocument() {
  return getMockStore().documents.find(
    (row) => row.archivedAt === null && row.status === "FIRMADO",
  )!;
}

const versionsOf = (documentId: string) =>
  getMockStore().documentVersions.filter((version) => version.documentId === documentId);

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("saveDocumentDraftAction", () => {
  it("stores the draft for Owner, Admin and Member without creating a version", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      asRole(role);
      const doc = markdownDocument();
      const before = versionsOf(doc.id).length;
      const content = `# Draft by ${role}`;
      const result = await saveDocumentDraftAction({ documentId: doc.id, content });
      expect(result).toMatchObject({ ok: true, data: { documentId: doc.id } });
      expect(doc.draftContent).toBe(content);
      expect(versionsOf(doc.id)).toHaveLength(before);
    }
  });

  it("refuses a Viewer with FORBIDDEN and leaves the draft untouched", async () => {
    asRole("VIEWER");
    const doc = markdownDocument();
    const draft = doc.draftContent;
    expect(await saveDocumentDraftAction({ documentId: doc.id, content: "# x" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(doc.draftContent).toBe(draft);
  });

  it("rejects an invalid input with VALIDATION", async () => {
    asRole("MEMBER");
    expect(await saveDocumentDraftAction({ documentId: "", content: "# x" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("refuses a signed document with INTEGRITY_LOCK", async () => {
    asRole("OWNER");
    const doc = signedDocument();
    expect(await saveDocumentDraftAction({ documentId: doc.id, content: "# x" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK" },
    });
  });
});

describe("publishDocumentVersionAction", () => {
  it("creates version N+1 with the changelog and makes it current", async () => {
    asRole("MEMBER");
    const doc = markdownDocument();
    const before = versionsOf(doc.id);
    const last = Math.max(...before.map((version) => version.versionNumber));
    const result = await publishDocumentVersionAction({
      documentId: doc.id,
      content: "# Published",
      changelog: "Scope updated",
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        versionCount: before.length + 1,
        draftContent: null,
        currentVersion: {
          versionNumber: last + 1,
          changelog: "Scope updated",
          content: "# Published",
          isCurrent: true,
        },
      },
    });
    expect(versionsOf(doc.id)).toHaveLength(before.length + 1);
  });

  it("refuses a Viewer with FORBIDDEN and creates no version", async () => {
    asRole("VIEWER");
    const doc = markdownDocument();
    const before = versionsOf(doc.id).length;
    expect(
      await publishDocumentVersionAction({ documentId: doc.id, content: "# x" }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(versionsOf(doc.id)).toHaveLength(before);
  });

  it("rejects a changelog over 500 characters with VALIDATION on the field", async () => {
    asRole("MEMBER");
    const doc = markdownDocument();
    const result = await publishDocumentVersionAction({
      documentId: doc.id,
      content: "# x",
      changelog: "a".repeat(501),
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(result.ok ? null : result.error.fieldErrors).toHaveProperty("changelog");
  });

  it("refuses a signed document with INTEGRITY_LOCK and creates no version", async () => {
    asRole("OWNER");
    const doc = signedDocument();
    const before = versionsOf(doc.id).length;
    expect(
      await publishDocumentVersionAction({ documentId: doc.id, content: "# x" }),
    ).toMatchObject({ ok: false, error: { code: "INTEGRITY_LOCK" } });
    expect(versionsOf(doc.id)).toHaveLength(before);
  });
});
