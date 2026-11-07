import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPortalApiClient } from "@/lib/api/client";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { loadPortalPage } from "./queries";

function portal(routes: Parameters<typeof mockApi>[0]) {
  const mock = mockApi(routes);
  return {
    calls: mock.calls,
    api: createPortalApiClient({ baseUrl: "http://api.test", fetch: mock.fetch }),
  };
}

describe("loadPortalPage", () => {
  it("returns the page of a live link and probes without any side effect", async () => {
    const page = { title: "Entrega", documents: [] };
    const { api, calls } = portal({ "GET /api/v1/portal/{token}": { body: page } });
    expect(await loadPortalPage("tok_1", api)).toEqual({ kind: "ok", page });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/v1/portal/tok_1"]);
    expect(calls[0]?.headers.has("authorization")).toBe(false);
  });

  // The BE answers the same 404 for an unknown, revoked, expired or ANULADO link: it never says why (C22).
  it.each(["unknown", "revoked", "expired", "ANULADO"])(
    "is the generic not-found for a %s link",
    async () => {
      const { api } = portal({ "GET /api/v1/portal/{token}": errorEnvelope("NOT_FOUND") });
      expect(await loadPortalPage("tok_1", api)).toEqual({ kind: "not-found" });
    },
  );

  it("is the try-again state when the probe is rate limited", async () => {
    const { api } = portal({ "GET /api/v1/portal/{token}": errorEnvelope("RATE_LIMITED") });
    expect(await loadPortalPage("tok_1", api)).toEqual({ kind: "rate-limited" });
  });

  it("lets any other failure reach the error boundary", async () => {
    const { api } = portal({ "GET /api/v1/portal/{token}": errorEnvelope("INTERNAL") });
    await expect(loadPortalPage("tok_1", api)).rejects.toThrow();
  });
});
