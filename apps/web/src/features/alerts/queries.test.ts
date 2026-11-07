import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
// next/navigation is not reached by these queries; the session module imports it, so it is stubbed.
vi.mock("next/navigation", () => ({ redirect: () => undefined }));

import { countUnreadAlerts, listAlerts } from "./queries";

const inbox = {
  total: 3,
  unread: 2,
  byType: { DOCUMENT_EXPIRED: 2, MISSING_RATE: 1 },
  readKeys: ["DOCUMENT_EXPIRED:doc_a"],
  items: [],
} as const;

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getServerApi.mockReset();
  mocks.auth.mockResolvedValue({ userId: "user_clerk", getToken: async () => "clerk-token" });
});

describe("listAlerts query (GET /api/v1/alerts)", () => {
  it("returns the inbox of the BE unchanged", async () => {
    const api = mockApi({ "GET /api/v1/alerts": { body: inbox } });
    mocks.getServerApi.mockResolvedValue(api.api);
    expect(await listAlerts()).toEqual(inbox);
  });

  it("sends the type narrowing and the limit", async () => {
    const api = mockApi({ "GET /api/v1/alerts": { body: inbox } });
    mocks.getServerApi.mockResolvedValue(api.api);
    await listAlerts({ types: ["DOCUMENT_EXPIRED"], limit: 5 });
    expect(api.calls[0]?.search.getAll("types")).toEqual(["DOCUMENT_EXPIRED"]);
    expect(api.calls[0]?.search.get("limit")).toBe("5");
  });

  it("throws UNAUTHENTICATED on a 401", async () => {
    const api = mockApi({ "GET /api/v1/alerts": errorEnvelope("UNAUTHENTICATED") });
    mocks.getServerApi.mockResolvedValue(api.api);
    await expect(listAlerts()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("countUnreadAlerts (the bell counter)", () => {
  it("is the unread counter of the BE, asked with the smallest page", async () => {
    const api = mockApi({ "GET /api/v1/alerts": { body: inbox } });
    mocks.getServerApi.mockResolvedValue(api.api);
    expect(await countUnreadAlerts()).toBe(2);
    expect(api.calls[0]?.search.get("limit")).toBe("1");
  });
});
