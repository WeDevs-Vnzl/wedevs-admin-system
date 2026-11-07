import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { makeSessionUser } from "@/lib/auth/testing";
import { getDocumentEditor } from "./editor-queries";
import { wireDetail, wireVersion } from "./wire-fixtures";

function use(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.api = mocked.api;
  return mocked;
}

const markdown = (content = "# Texto") =>
  wireVersion({ format: "MARKDOWN", file: null, content, url: null });

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  asRole("MEMBER");
});

describe("getDocumentEditor", () => {
  it("opens an unsigned markdown document for editing, starting from its draft", async () => {
    use({
      "GET /api/v1/documents/{id}": {
        body: wireDetail({ currentVersion: markdown(), draftContent: "# Pending draft" }),
      },
    });
    expect(await getDocumentEditor("doc_1")).toMatchObject({
      availability: "editable",
      content: "# Pending draft",
      document: { id: "doc_1" },
    });
  });

  it("starts from the current version when there is no draft", async () => {
    use({
      "GET /api/v1/documents/{id}": {
        body: wireDetail({ currentVersion: markdown("# V2"), draftContent: null }),
      },
    });
    expect((await getDocumentEditor("doc_1"))?.content).toBe("# V2");
  });

  it("reports a signed document as locked and a file document as not editable", async () => {
    use({
      "GET /api/v1/documents/{id}": {
        body: wireDetail({ status: "FIRMADO", currentVersion: markdown() }),
      },
    });
    expect(await getDocumentEditor("doc_1")).toMatchObject({ availability: "signed" });
    use({ "GET /api/v1/documents/{id}": { body: wireDetail() } });
    expect(await getDocumentEditor("doc_1")).toMatchObject({ availability: "notMarkdown" });
  });

  it("answers null to a Viewer (no call), an unknown id, a malformed id and an archived document", async () => {
    const { calls } = use({ "GET /api/v1/documents/{id}": { body: wireDetail() } });
    asRole("VIEWER");
    expect(await getDocumentEditor("doc_1")).toBeNull();
    expect(calls).toHaveLength(0);

    asRole("MEMBER");
    use({ "GET /api/v1/documents/{id}": errorEnvelope("NOT_FOUND") });
    expect(await getDocumentEditor("doc_x")).toBeNull();
    expect(await getDocumentEditor("")).toBeNull();

    use({
      "GET /api/v1/documents/{id}": {
        body: wireDetail({ currentVersion: markdown(), archivedAt: "2026-02-01T00:00:00.000Z" }),
      },
    });
    expect(await getDocumentEditor("doc_1")).toBeNull();
  });
});
