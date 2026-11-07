import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { CLIENT_ROOT_GRAPH } from "../testing/graph-http-fixtures";

// The entity graph screen maps the read result: NOT_FOUND and FORBIDDEN answer the not-found page, any other failure
// throws to the error state. HTTP is the test double; the session and the translations are stubbed.

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getServerApi: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { EntityGraphScreen } from "./entity-graph-screen";

const ME_BODY = {
  id: "usr_ana",
  name: "Ana Pérez",
  email: "ana.perez@example.com",
  imageUrl: null,
  role: "ADMIN",
  locale: "es",
  theme: "system",
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
};

function serve(graphRoute: RouteTable[string]) {
  const api = mockApi({
    "GET /api/v1/me": { status: 200, body: ME_BODY },
    "GET /api/v1/graph/{type}/{id}": graphRoute,
  });
  mocks.getServerApi.mockResolvedValue(api.api);
  return api;
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getServerApi.mockReset();
  mocks.auth.mockResolvedValue({ userId: "user_clerk_ana", getToken: async () => "clerk-token" });
});

const render = () => EntityGraphScreen({ type: "CLIENT", id: "cli_kairos" });

describe("EntityGraphScreen read mapping", () => {
  it("renders the screen for a readable record", async () => {
    const api = serve({ status: 200, body: CLIENT_ROOT_GRAPH });
    await expect(render()).resolves.toBeDefined();
    expect(api.calls.map((call) => call.path)).toContain("/api/v1/graph/CLIENT/cli_kairos");
  });

  // NOT_FOUND: an unknown id, or an archived record without the trash grant. FORBIDDEN: a role that may not read it.
  it.each(["NOT_FOUND", "FORBIDDEN"] as const)("answers the not-found page on %s", async (code) => {
    serve(errorEnvelope(code));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("throws any other failure, so the error state shows", async () => {
    serve(errorEnvelope("INTERNAL"));
    await expect(render()).rejects.toThrow("GET /api/v1/graph/CLIENT/cli_kairos failed: INTERNAL");
  });
});
