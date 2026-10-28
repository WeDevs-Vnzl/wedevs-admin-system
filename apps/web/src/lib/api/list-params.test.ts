import { describe, expect, it } from "vitest";
import { listQuerySchema } from "@/lib/validators/common";
import { toApiListParams } from "./list-params";

const base = listQuerySchema.parse({});

describe("toApiListParams", () => {
  it("passes page, pageSize, sort and q through", () => {
    const query = listQuerySchema.parse({ page: "3", pageSize: "50", sort: "name:asc", q: "acme" });
    expect(toApiListParams(query)).toEqual({
      page: 3,
      pageSize: 50,
      sort: "name:asc",
      q: "acme",
      archived: "exclude",
    });
  });

  it("omits sort and q when absent", () => {
    const params = toApiListParams(base);
    expect(params).toEqual({ page: 1, pageSize: 25, archived: "exclude" });
    expect(params).not.toHaveProperty("sort");
    expect(params).not.toHaveProperty("q");
  });

  it("maps includeArchived to archived=include", () => {
    expect(toApiListParams({ ...base, includeArchived: true }).archived).toBe("include");
    expect(toApiListParams({ ...base, includeArchived: false }).archived).toBe("exclude");
  });

  it("lets the screen ask for archived=only, which wins over includeArchived", () => {
    expect(toApiListParams(base, { archived: "only" }).archived).toBe("only");
    expect(toApiListParams({ ...base, includeArchived: true }, { archived: "only" }).archived).toBe(
      "only",
    );
  });

  it("flattens facets: scalar for one value, repeated-key list for several", () => {
    const query = {
      ...base,
      filters: { status: ["ACTIVO", "PROSPECTO"], clientId: "c1", empty: [], blank: "" },
    };
    expect(toApiListParams(query)).toMatchObject({
      status: ["ACTIVO", "PROSPECTO"],
      clientId: "c1",
    });
    const params = toApiListParams(query);
    expect(params).not.toHaveProperty("empty");
    expect(params).not.toHaveProperty("blank");
  });

  it("splits date-range facets into from/to keys", () => {
    const query = { ...base, filters: { issued: ["2026-01-01", "2026-01-31"] } };
    expect(
      toApiListParams(query, {
        facets: [{ id: "issued", kind: "dateRange", fromKey: "issuedFrom", toKey: "issuedTo" }],
      }),
    ).toMatchObject({ issuedFrom: "2026-01-01", issuedTo: "2026-01-31" });
  });

  it("serializes repeated keys through URLSearchParams semantics (array values)", () => {
    const params = toApiListParams({ ...base, filters: { status: ["A", "B"] } });
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
    }
    expect(search.getAll("status")).toEqual(["A", "B"]);
  });

  it("does not let a filter override the base keys or reach the prototype", () => {
    const params = toApiListParams({
      ...base,
      filters: { page: "9", archived: "only", __proto__: "x", constructor: "y" } as never,
    });
    expect(params.page).toBe(1);
    expect(params.archived).toBe("exclude");
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
  });
});
