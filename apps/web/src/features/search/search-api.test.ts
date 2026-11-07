import { afterEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { searchGlobalRecords } from "./search-api";

// MOCK — HTTP fixture only: the grouped answer the BE would return; no domain logic runs here.
const EMPTY_RESULTS = { query: "garcia", entityType: null, groups: [] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchGlobalRecords (GET /api/v1/search, PRD §7.6)", () => {
  it("sends the raw query with its prefix and the requested types as repeated keys", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/search": { body: EMPTY_RESULTS } });

    await searchGlobalRecords(api, { q: "c: garcia", entityTypes: ["CLIENT", "NOTE"], limit: 10 });

    const search = calls[0]?.search;
    expect(search?.get("q")).toBe("c: garcia");
    expect(search?.getAll("entityTypes")).toEqual(["CLIENT", "NOTE"]);
    expect(search?.get("limit")).toBe("10");
  });

  it("asks for archived records only when asked (HU-28 CA1)", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/search": { body: EMPTY_RESULTS } });

    await searchGlobalRecords(api, { q: "garcia" });
    await searchGlobalRecords(api, { q: "garcia", includeArchived: true });

    expect(calls[0]?.search.has("includeArchived")).toBe(false);
    expect(calls[1]?.search.get("includeArchived")).toBe("true");
  });

  it("returns the grouped results exactly as the BE sent them", async () => {
    const body = {
      query: "fac-0012",
      entityType: null,
      groups: [
        {
          entityType: "INVOICE",
          total: 1,
          items: [
            {
              archived: false,
              code: "FAC-0012",
              entityId: "inv_1",
              entityType: "INVOICE",
              status: "EMITIDA",
              subtitle: null,
              title: "Cliente Demo",
            },
          ],
        },
      ],
    };
    const { api } = mockApi({ "GET /api/v1/search": { body } });

    expect(await searchGlobalRecords(api, { q: "fac-0012" })).toEqual({ ok: true, data: body });
  });

  it("maps the BE error envelope to an ActionError the UI can show", async () => {
    const { api } = mockApi({
      "GET /api/v1/search": errorEnvelope("VALIDATION", {
        fieldErrors: { q: ["validation.q.too_long"] },
      }),
    });

    const result = await searchGlobalRecords(api, { q: "x" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { q: ["validation.q.too_long"] } },
    });
  });

  it("maps a network failure to INTERNAL without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { api } = mockApi({});

    expect(await searchGlobalRecords(api, { q: "garcia" })).toMatchObject({
      ok: false,
      error: { code: "INTERNAL" },
    });
  });
});
