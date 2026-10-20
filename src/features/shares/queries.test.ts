import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
vi.mock("@/mocks/services/shares", () => ({}));
const documents = vi.hoisted(() => ({ getDocument: vi.fn(), listDocumentVersions: vi.fn() }));
vi.mock("@/mocks/services/documents", () => documents);

import { makeSessionUser } from "@/mocks/test-helpers";
import { ServiceError } from "@/server/errors";
import { getShareableDocuments, getSharePermissions } from "./queries";

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

describe("getShareableDocuments", () => {
  it("keeps the order and leaves out unknown, archived and malformed ids", async () => {
    documents.getDocument.mockImplementation(async (_ctx, { id }: { id: string }) => {
      if (id === "doc_missing") throw new ServiceError("NOT_FOUND");
      return {
        id,
        code: id.toUpperCase(),
        title: `Title ${id}`,
        status: "APROBADO",
        archivedAt: id === "doc_archived" ? "2026-10-01T00:00:00.000Z" : null,
        currentVersion: null,
      };
    });
    documents.listDocumentVersions.mockResolvedValue([]);

    const result = await getShareableDocuments([
      "doc_b",
      "doc_missing",
      "bad id!",
      "doc_archived",
      "doc_a",
    ]);

    expect(result.map((doc) => doc.id)).toEqual(["doc_b", "doc_a"]);
    expect(result[0]).toMatchObject({ currentVersionId: null, versions: [] });
  });
});
