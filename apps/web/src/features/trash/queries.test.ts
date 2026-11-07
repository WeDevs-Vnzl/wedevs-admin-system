import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { getTrash } from "./queries";

const page = { items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getTrash (Settings → Papelera first page)", () => {
  it("reads the page for the URL filter from the API", async () => {
    const mocked = mockApi({ "GET /api/v1/trash": { body: page } });
    mocks.getServerApi.mockResolvedValue(mocked.api);
    expect(await getTrash({ entityType: ["NOTE"], pageSize: 25 })).toEqual(page);
    expect(mocked.calls[0]?.search.getAll("entityType")).toEqual(["NOTE"]);
  });

  it("throws when the BE refuses the read, so the route error boundary takes it", async () => {
    const mocked = mockApi({ "GET /api/v1/trash": errorEnvelope("FORBIDDEN") });
    mocks.getServerApi.mockResolvedValue(mocked.api);
    await expect(getTrash({})).rejects.toThrow("FORBIDDEN");
  });
});
