import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => server.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  getFiscalSettings,
  listCurrencies,
  listDocumentCategories,
  listDocumentTypes,
  listExpenseCategories,
  listPaymentMethods,
  listTags,
  listTechnologies,
} from "./queries";
import { CatalogReadError } from "./read";

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.api = mocked.api;
  return mocked;
}

beforeEach(() => {
  server.api = null;
});

const usd = { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, active: true };

describe("catalog list reads", () => {
  it("lists the active currencies by default and every row with includeInactive", async () => {
    const { calls } = useApi({ "GET /api/v1/currencies": { body: [usd] } });
    expect(await listCurrencies()).toEqual([usd]);
    await listCurrencies({ includeInactive: true });
    expect(calls[0]?.search.has("includeInactive")).toBe(false);
    expect(calls[1]?.search.get("includeInactive")).toBe("true");
  });

  it("lists payment methods", async () => {
    const method = {
      id: "pm1",
      code: "ZELLE",
      name: "Zelle",
      nameEn: null,
      requiresReference: true,
      suggestsIgtf: true,
      active: true,
    };
    const { calls } = useApi({ "GET /api/v1/payment-methods": { body: [method] } });
    expect(await listPaymentMethods({ includeInactive: true })).toEqual([method]);
    expect(calls[0]?.search.get("includeInactive")).toBe("true");
  });

  it("lists the expense category tree", async () => {
    const root = {
      id: "c1",
      name: "Hosting",
      nameEn: null,
      color: null,
      parentId: null,
      active: true,
      children: [],
    };
    useApi({ "GET /api/v1/expense-categories": { body: [root] } });
    expect(await listExpenseCategories()).toEqual([root]);
  });

  it("returns the fiscal parameters with decimal strings and no method codes (the BE has none)", async () => {
    useApi({
      "GET /api/v1/settings/fiscal": {
        body: {
          ivaRates: ["16", "8", "0"],
          ivaDefaultRate: "16",
          igtfRate: "3",
          igtfCurrencies: ["USD"],
          invoiceDefaultDueDays: 15,
        },
      },
    });
    expect(await getFiscalSettings()).toEqual({
      ivaRates: ["16", "8", "0"],
      ivaDefaultRate: "16",
      igtfRate: "3",
      igtfCurrencies: ["USD"],
      igtfMethodCodes: [],
      invoiceDefaultDueDays: 15,
    });
  });

  it("throws the mapped error when the read fails", async () => {
    useApi({ "GET /api/v1/currencies": errorEnvelope("FORBIDDEN") });
    await expect(listCurrencies()).rejects.toBeInstanceOf(CatalogReadError);
    await expect(listCurrencies()).rejects.toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

describe("picker reads (read-only; the writes belong to taxonomy)", () => {
  const page = { total: 0, page: 1, pageSize: 25, pageCount: 1 };

  it("listTags → GET /tags with the parsed filter", async () => {
    const { calls } = useApi({ "GET /api/v1/tags": { body: { items: [], ...page } } });
    await listTags({ q: "cli", sort: "usageCount:desc", entityType: "CLIENT" });
    const search = calls[0]!.search;
    expect(search.get("q")).toBe("cli");
    expect(search.get("sort")).toBe("usageCount:desc");
    expect(search.getAll("entityType")).toEqual(["CLIENT"]);
    expect(search.get("page")).toBe("1");
    expect(search.get("pageSize")).toBe("25");
  });

  it("listTechnologies → GET /technologies with category and active facets", async () => {
    const { calls } = useApi({ "GET /api/v1/technologies": { body: { items: [], ...page } } });
    await listTechnologies({ category: "IA", active: true, pageSize: "100" as never });
    const search = calls[0]!.search;
    expect(search.getAll("category")).toEqual(["IA"]);
    expect(search.get("active")).toBe("true");
    expect(search.get("pageSize")).toBe("100");
  });

  it("listDocumentCategories → GET /document-categories", async () => {
    const category = { id: "dc1", name: "Legal", nameEn: null, color: null, order: 0, types: [] };
    useApi({ "GET /api/v1/document-categories": { body: [category] } });
    expect(await listDocumentCategories()).toEqual([category]);
  });

  it("listDocumentTypes → GET /document-types with boolean facets as strings", async () => {
    const { calls } = useApi({ "GET /api/v1/document-types": { body: { items: [], ...page } } });
    await listDocumentTypes({ requiresSignature: "true" as never, categoryId: "dc1" });
    const search = calls[0]!.search;
    expect(search.get("requiresSignature")).toBe("true");
    expect(search.getAll("categoryId")).toEqual(["dc1"]);
  });

  it("rejects an invalid filter before calling the API", async () => {
    const { calls } = useApi({});
    await expect(listTechnologies({ sort: "bogus" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
