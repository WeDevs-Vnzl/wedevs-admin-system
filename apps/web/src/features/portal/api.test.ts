import { describe, expect, it } from "vitest";
import { createPortalApiClient } from "@/lib/api/client";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import {
  fetchPortalDocument,
  fetchPortalPage,
  recordPortalView,
  unlockPortalDocument,
} from "./api";

function portal(routes: Parameters<typeof mockApi>[0]) {
  const mock = mockApi(routes);
  return {
    calls: mock.calls,
    api: createPortalApiClient({ baseUrl: "http://api.test", fetch: mock.fetch }),
  };
}

describe("portal API wrappers", () => {
  it("reads the page of a link and never sends Authorization", async () => {
    const page = { title: "Entrega", documents: [] };
    const { api, calls } = portal({ "GET /api/v1/portal/{token}": { body: page } });
    expect(await fetchPortalPage(api, "tok_1")).toEqual({ ok: true, data: page });
    expect(calls[0]?.path).toBe("/api/v1/portal/tok_1");
    expect(calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("maps a 404 and a 429 of the page to the error codes", async () => {
    const missing = portal({ "GET /api/v1/portal/{token}": errorEnvelope("NOT_FOUND") });
    expect(await fetchPortalPage(missing.api, "x")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    const limited = portal({ "GET /api/v1/portal/{token}": errorEnvelope("RATE_LIMITED") });
    expect(await fetchPortalPage(limited.api, "x")).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
  });

  it("reads one document", async () => {
    const view = {
      document: { documentId: "d1" },
      content: { format: "MARKDOWN", markdown: "hi" },
    };
    const { api, calls } = portal({
      "GET /api/v1/portal/{token}/documents/{documentId}": { body: view },
    });
    expect(await fetchPortalDocument(api, "tok_1", "d1")).toEqual({ ok: true, data: view });
    expect(calls[0]?.path).toBe("/api/v1/portal/tok_1/documents/d1");
  });

  it("unlocks with the key in the body only", async () => {
    const { api, calls } = portal({
      "POST /api/v1/portal/{token}/documents/{documentId}/unlock": {
        body: { documentId: "d1", unlocked: true },
      },
    });
    expect(await unlockPortalDocument(api, "tok_1", "d1", "SECRET-KEY-1")).toEqual({
      ok: true,
      data: { documentId: "d1", unlocked: true },
    });
    expect(calls[0]?.body).toEqual({ key: "SECRET-KEY-1" });
    expect(calls[0]?.path).not.toContain("SECRET");
    expect(calls[0]?.search.toString()).toBe("");
  });

  it("records a view of the link, or of a document", async () => {
    const { api, calls } = portal({
      "POST /api/v1/portal/{token}/views": { status: 201, body: { recorded: true } },
    });
    await recordPortalView(api, "tok_1");
    await recordPortalView(api, "tok_1", "d1");
    expect(calls.map((c) => c.body)).toEqual([{}, { documentId: "d1" }]);
  });
});
