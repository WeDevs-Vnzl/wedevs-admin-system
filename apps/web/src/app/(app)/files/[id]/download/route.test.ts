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
import { GET } from "./route";

const signed = "https://res.cloudinary.test/signed/abc?sig=1";

function use(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}
const call = (id = "fil_1") =>
  GET(new Request(`http://localhost/files/${id}/download`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  server.getServerApi.mockReset();
  nav.notFound.mockClear();
  nav.redirect.mockClear();
});

describe("GET /files/[id]/download", () => {
  it("answers 302 to the BE's Location, uncached", async () => {
    const { calls } = use({
      "GET /api/v1/files/{id}/download": { status: 302, headers: { location: signed } },
    });
    const response = await call();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(signed);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls[0]?.path).toBe("/api/v1/files/fil_1/download");
  });

  it("renders the in-shell not-found for the BE's 404 and 403", async () => {
    use({ "GET /api/v1/files/{id}/download": errorEnvelope("NOT_FOUND") });
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
    use({ "GET /api/v1/files/{id}/download": errorEnvelope("FORBIDDEN") });
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toHaveBeenCalledTimes(2);
  });

  it("sends an unauthenticated caller to sign-in", async () => {
    use({ "GET /api/v1/files/{id}/download": errorEnvelope("UNAUTHENTICATED") });
    await expect(call()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("answers 502 when the BE gives no usable redirect", async () => {
    use({ "GET /api/v1/files/{id}/download": errorEnvelope("INTERNAL") });
    expect((await call()).status).toBe(502);
  });
});
