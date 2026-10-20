import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);

// The shares service is another task (T7): it is mocked whole. The documents reads and the status change are
// stubbed so the `ENVIADO` proposal can be checked without the store.
const shares = vi.hoisted(() => ({
  createShareLink: vi.fn(),
  updateShareLink: vi.fn(),
  revokeShareLink: vi.fn(),
  setShareDocumentAccessKey: vi.fn(),
  listShareLinks: vi.fn(),
  getShareLink: vi.fn(),
  listShareAccessLog: vi.fn(),
}));
vi.mock("@/mocks/services/shares", () => shares);
const documents = vi.hoisted(() => ({
  getDocument: vi.fn(),
  listDocumentVersions: vi.fn(),
  setDocumentStatus: vi.fn(),
}));
vi.mock("@/mocks/services/documents", () => documents);

import { makeSessionUser } from "@/mocks/test-helpers";
import { ServiceError } from "@/server/errors";
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

type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
function asRole(role: Role) {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
}

const createInput = {
  title: "Contract documents",
  documents: [{ documentId: "doc_0001", versionId: null, requiresAccessKey: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(shares)) fn.mockResolvedValue({ ok: "service" });
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

// Every action, with a valid input and the service function it reaches.
const cases = [
  ["createShareLinkAction", () => createShareLinkAction(createInput), shares.createShareLink],
  [
    "updateShareLinkAction",
    () => updateShareLinkAction({ id: "shl_0001", ...createInput }),
    shares.updateShareLink,
  ],
  [
    "revokeShareLinkAction",
    () => revokeShareLinkAction({ id: "shl_0001" }),
    shares.revokeShareLink,
  ],
  [
    "setShareDocumentAccessKeyAction",
    () =>
      setShareDocumentAccessKeyAction({
        shareLinkId: "shl_0001",
        documentId: "doc_0001",
        action: "regenerate",
      }),
    shares.setShareDocumentAccessKey,
  ],
  ["listShareLinksAction", () => listShareLinksAction({}), shares.listShareLinks],
  [
    "listShareAccessLogAction",
    () => listShareAccessLogAction({ shareLinkId: "shl_0001" }),
    shares.listShareAccessLog,
  ],
] as const;

describe.each(cases)("%s", (_name, run, service) => {
  it.each(["MEMBER", "VIEWER"] as const)(
    "refuses %s with FORBIDDEN before the service",
    async (role) => {
      asRole(role);
      const result = await run();
      expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(["OWNER", "ADMIN"] as const)("lets %s through to the service", async (role) => {
    asRole(role);
    const result = await run();
    expect(result).toEqual({ ok: true, data: { ok: "service" } });
    expect(service).toHaveBeenCalledTimes(1);
  });
});

describe("input validation (zod)", () => {
  beforeEach(() => asRole("OWNER"));

  it("rejects a link without documents", async () => {
    const result = await createShareLinkAction({ ...createInput, documents: [] });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(shares.createShareLink).not.toHaveBeenCalled();
  });

  it("rejects a blank title on update", async () => {
    const result = await updateShareLinkAction({ id: "shl_0001", ...createInput, title: "  " });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(shares.updateShareLink).not.toHaveBeenCalled();
  });

  it("rejects an unknown key action", async () => {
    const result = await setShareDocumentAccessKeyAction({
      shareLinkId: "shl_0001",
      documentId: "doc_0001",
      action: "reveal" as never,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(shares.setShareDocumentAccessKey).not.toHaveBeenCalled();
  });

  it("rejects a revoke without an id", async () => {
    const result = await revokeShareLinkAction({} as never);
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(shares.revokeShareLink).not.toHaveBeenCalled();
  });

  it("passes the service the parsed defaults (latest version, download allowed, es)", async () => {
    await createShareLinkAction({ title: "T", documents: [{ documentId: "doc_0001" }] });
    expect(shares.createShareLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowDownload: true,
        locale: "es",
        documents: [{ documentId: "doc_0001", versionId: null, requiresAccessKey: false }],
      }),
    );
  });
});

describe("getShareableDocumentAction", () => {
  it("refuses MEMBER", async () => {
    asRole("MEMBER");
    const result = await getShareableDocumentAction({ id: "doc_0001" });
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(documents.getDocument).not.toHaveBeenCalled();
  });

  it("rejects a malformed id", async () => {
    asRole("OWNER");
    const result = await getShareableDocumentAction({ id: "" });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("returns the document with its versions newest first", async () => {
    asRole("ADMIN");
    documents.getDocument.mockResolvedValue({
      id: "doc_0001",
      code: "DOC-0001",
      title: "Contract",
      status: "APROBADO",
      archivedAt: null,
      currentVersion: { id: "ver_2" },
    });
    documents.listDocumentVersions.mockResolvedValue([
      { id: "ver_1", versionNumber: 1 },
      { id: "ver_2", versionNumber: 2 },
    ]);
    const result = await getShareableDocumentAction({ id: "doc_0001" });
    expect(result).toEqual({
      ok: true,
      data: {
        id: "doc_0001",
        code: "DOC-0001",
        title: "Contract",
        status: "APROBADO",
        currentVersionId: "ver_2",
        versions: [
          { id: "ver_2", versionNumber: 2 },
          { id: "ver_1", versionNumber: 1 },
        ],
      },
    });
  });
});

describe("markDocumentsSentAction", () => {
  it("refuses VIEWER before touching any document", async () => {
    asRole("VIEWER");
    const result = await markDocumentsSentAction({ documentIds: ["doc_0001"] });
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(documents.setDocumentStatus).not.toHaveBeenCalled();
  });

  it("rejects an empty or repeated list", async () => {
    asRole("OWNER");
    expect(await markDocumentsSentAction({ documentIds: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(await markDocumentsSentAction({ documentIds: ["doc_0001", "doc_0001"] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(documents.setDocumentStatus).not.toHaveBeenCalled();
  });

  it("moves only the documents that are APROBADO to ENVIADO", async () => {
    asRole("OWNER");
    const statuses: Record<string, string> = {
      doc_0001: "APROBADO",
      doc_0002: "BORRADOR",
      doc_0003: "APROBADO",
    };
    documents.getDocument.mockImplementation(async (_ctx, { id }: { id: string }) => ({
      id,
      status: statuses[id],
    }));
    documents.setDocumentStatus.mockImplementation(async (_ctx, { id }: { id: string }) => {
      if (id === "doc_0003") throw new ServiceError("VALIDATION");
      return { id };
    });

    const result = await markDocumentsSentAction({
      documentIds: ["doc_0001", "doc_0002", "doc_0003"],
    });

    expect(result).toEqual({
      ok: true,
      data: { sent: ["doc_0001"], skipped: ["doc_0002"], failed: ["doc_0003"] },
    });
    expect(documents.setDocumentStatus).toHaveBeenCalledTimes(2);
    expect(documents.setDocumentStatus).toHaveBeenCalledWith(expect.anything(), {
      id: "doc_0001",
      status: "ENVIADO",
    });
  });
});
