import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/navigation", () => nav);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { wireDetail, wireVersion } from "@/features/documents/wire-fixtures";
import { GET } from "./route";

function use(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}
const get = (id = "doc_1", versionId = "ver_2") =>
  GET(new Request(`http://localhost/documents/${id}/versions/${versionId}/file`), {
    params: Promise.resolve({ id, versionId }),
  });

const markdownVersion = wireVersion({
  format: "MARKDOWN",
  file: null,
  content: "# Título\n\nCuerpo",
});

beforeEach(() => {
  server.getServerApi.mockReset();
  nav.notFound.mockClear();
  nav.redirect.mockClear();
});

describe("GET /documents/[id]/versions/[versionId]/file (markdown attachment only)", () => {
  it("answers the stored markdown as an attachment named <code>-v<n>.md, never cached or sniffed", async () => {
    const { calls } = use({
      "GET /api/v1/documents/{id}/versions/{versionId}": { body: markdownVersion },
      "GET /api/v1/documents/{id}": { body: wireDetail() },
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="DOC-0001-v2.md"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("# Título\n\nCuerpo");
    expect(calls.map((call) => call.path).sort()).toEqual([
      "/api/v1/documents/doc_1",
      "/api/v1/documents/doc_1/versions/ver_2",
    ]);
  });

  it("renders the in-shell not-found for the BE's 404 and 403", async () => {
    use({ "GET /api/v1/documents/{id}/versions/{versionId}": errorEnvelope("NOT_FOUND") });
    await expect(get()).rejects.toThrow("NEXT_NOT_FOUND");
    use({ "GET /api/v1/documents/{id}/versions/{versionId}": errorEnvelope("FORBIDDEN") });
    await expect(get()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toHaveBeenCalledTimes(2);
  });

  it("sends an unauthenticated caller to sign-in", async () => {
    use({ "GET /api/v1/documents/{id}/versions/{versionId}": errorEnvelope("UNAUTHENTICATED") });
    await expect(get()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("is not-found for an ARCHIVO or ENLACE version: files go through the file route, links are external", async () => {
    use({
      "GET /api/v1/documents/{id}/versions/{versionId}": { body: wireVersion() },
      "GET /api/v1/documents/{id}": { body: wireDetail() },
    });
    await expect(get()).rejects.toThrow("NEXT_NOT_FOUND");
    use({
      "GET /api/v1/documents/{id}/versions/{versionId}": {
        body: wireVersion({ format: "ENLACE", file: null, url: "https://example.com" }),
      },
      "GET /api/v1/documents/{id}": { body: wireDetail() },
    });
    await expect(get()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers 502 when the BE fails", async () => {
    use({ "GET /api/v1/documents/{id}/versions/{versionId}": errorEnvelope("INTERNAL") });
    expect((await get()).status).toBe(502);
  });
});
