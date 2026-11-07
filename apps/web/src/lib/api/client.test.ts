import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: clerk.getToken }) }));

import {
  createApiClient,
  createPortalApiClient,
  isPortalPath,
  portalFileUrl,
  useApiClient,
  usePortalApiClient,
} from "./client";

function recorder() {
  const requests: Request[] = [];
  const fetchMock = vi.fn(async (request: Request) => {
    requests.push(request);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { requests, fetchMock };
}

describe("createApiClient token middleware", () => {
  it("adds Authorization: Bearer when a token exists", async () => {
    const { requests, fetchMock } = recorder();
    const api = createApiClient({
      baseUrl: "http://api.test",
      getToken: async () => "tok-1",
      fetch: fetchMock,
    });
    await api.GET("/api/v1/health" as never);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer tok-1");
    expect(requests[0]?.url).toBe("http://api.test/api/v1/health");
  });

  it("omits the header when there is no token", async () => {
    const { requests, fetchMock } = recorder();
    const api = createApiClient({
      baseUrl: "http://api.test",
      getToken: async () => null,
      fetch: fetchMock,
    });
    await api.GET("/api/v1/health" as never);
    expect(requests[0]?.headers.has("authorization")).toBe(false);
  });

  it("never sends the token to /api/v1/portal/** and does not even ask for it", async () => {
    const { requests, fetchMock } = recorder();
    const getToken = vi.fn(async () => "tok-1");
    const api = createApiClient({ baseUrl: "http://api.test", getToken, fetch: fetchMock });
    await api.GET("/api/v1/portal/abc/documents" as never);
    expect(requests[0]?.headers.has("authorization")).toBe(false);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("keeps an Authorization header the caller set", async () => {
    const { requests, fetchMock } = recorder();
    const api = createApiClient({
      baseUrl: "http://api.test",
      getToken: async () => "tok-1",
      fetch: fetchMock,
    });
    await api.GET("/api/v1/health" as never, { headers: { Authorization: "Bearer own" } } as never);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer own");
  });

  it("falls back to NEXT_PUBLIC_API_BASE_URL and throws when none is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://env.test");
    expect(() => createApiClient({ getToken: async () => null })).not.toThrow();
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    expect(() => createApiClient({ getToken: async () => null })).toThrow(
      /NEXT_PUBLIC_API_BASE_URL/,
    );
    vi.unstubAllEnvs();
  });
});

describe("isPortalPath", () => {
  it("matches only the portal prefix", () => {
    expect(isPortalPath("/api/v1/portal/tok/files/d1")).toBe(true);
    expect(isPortalPath("/api/v1/portal")).toBe(true);
    expect(isPortalPath("/api/v1/portals")).toBe(false);
    expect(isPortalPath("/api/v1/clients")).toBe(false);
  });
});

describe("useApiClient", () => {
  beforeEach(() => {
    clerk.getToken.mockReset();
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
  });

  it("builds a client that reads the Clerk token on each request", async () => {
    clerk.getToken.mockResolvedValue("clerk-tok");
    const { requests, fetchMock } = recorder();
    let client: ReturnType<typeof useApiClient> | undefined;
    function Probe() {
      client = useApiClient({ fetch: fetchMock });
      return null;
    }
    renderToString(createElement(Probe));
    await client!.GET("/api/v1/health" as never);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer clerk-tok");
  });
});

describe("createPortalApiClient", () => {
  it("sends credentials and never an Authorization header", async () => {
    const { requests, fetchMock } = recorder();
    const api = createPortalApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
    await api.GET("/api/v1/portal/abc" as never);
    expect(requests[0]?.credentials).toBe("include");
    expect(requests[0]?.headers.has("authorization")).toBe(false);
    expect(requests[0]?.url).toBe("http://api.test/api/v1/portal/abc");
  });

  it("drops an Authorization header a caller sets", async () => {
    const { requests, fetchMock } = recorder();
    const api = createPortalApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
    await api.GET(
      "/api/v1/portal/abc" as never,
      { headers: { Authorization: "Bearer x" } } as never,
    );
    expect(requests[0]?.headers.has("authorization")).toBe(false);
  });

  it("throws when no base URL is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    expect(() => createPortalApiClient()).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
    vi.unstubAllEnvs();
  });

  it("is built by usePortalApiClient without touching Clerk", async () => {
    clerk.getToken.mockReset();
    const { requests, fetchMock } = recorder();
    let client: ReturnType<typeof usePortalApiClient> | undefined;
    function Probe() {
      client = usePortalApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
      return null;
    }
    renderToString(createElement(Probe));
    await client!.GET("/api/v1/portal/abc" as never);
    expect(requests[0]?.headers.has("authorization")).toBe(false);
    expect(clerk.getToken).not.toHaveBeenCalled();
  });
});

describe("portalFileUrl", () => {
  it("points at the API origin file route with the disposition", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test/");
    expect(portalFileUrl("tok_1", "doc 1", "attachment")).toBe(
      "http://api.test/api/v1/portal/tok_1/files/doc%201?disposition=attachment",
    );
    expect(portalFileUrl("tok_1", "d1", "inline")).toBe(
      "http://api.test/api/v1/portal/tok_1/files/d1?disposition=inline",
    );
    vi.unstubAllEnvs();
  });
});
