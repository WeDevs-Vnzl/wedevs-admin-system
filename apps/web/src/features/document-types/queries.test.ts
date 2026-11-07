import { describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";

vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@/lib/api/server", () => server);

import { listDocumentCategories } from "./queries";

const category = {
  id: "dcat_legal",
  name: "Legal",
  nameEn: "Legal",
  color: "#6d28d9",
  order: 0,
  types: [
    {
      id: "dtyp_nda",
      name: "Acuerdo de confidencialidad",
      nameEn: null,
      defaultFormat: "ARCHIVO",
      requiresSignature: true,
      hasExpiration: false,
      active: true,
      documentCount: 4,
    },
  ],
};

describe("listDocumentCategories", () => {
  it("reads every category in order, each with its types, through GET /api/v1/document-categories", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/document-categories": { body: [category] } });
    server.getServerApi.mockResolvedValue(api);

    await expect(listDocumentCategories()).resolves.toEqual([category]);
    expect(calls[0]?.path).toBe("/api/v1/document-categories");
    expect(calls[0]?.method).toBe("GET");
  });

  it("throws when the BE answers with an error envelope", async () => {
    const { api } = mockApi({ "GET /api/v1/document-categories": errorEnvelope("FORBIDDEN") });
    server.getServerApi.mockResolvedValue(api);

    await expect(listDocumentCategories()).rejects.toThrow(
      "GET /api/v1/document-categories failed with 403",
    );
  });
});
