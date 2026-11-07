import { describe, expect, it } from "vitest";
import { invoiceFiltersSchema } from "@/lib/validators/invoices";
import { toInvoiceListQuery } from "./api-query";

describe("toInvoiceListQuery (api-contract §3)", () => {
  it("sends the page, size, sort and search as flat keys with archived=exclude", () => {
    const filter = invoiceFiltersSchema.parse({
      page: 2,
      pageSize: 50,
      sort: "issueDate:desc",
      q: "0001",
    });
    expect(toInvoiceListQuery(filter)).toEqual({
      page: 2,
      pageSize: 50,
      sort: "issueDate:desc",
      q: "0001",
      archived: "exclude",
    });
  });

  it("sends the facets (status, client, project, currency, tag, issue-date range) as flat keys", () => {
    const filter = invoiceFiltersSchema.parse({
      status: ["EMITIDA", "VENCIDA"],
      clientId: "cli_1",
      projectId: ["prj_1"],
      currency: "USD",
      tagId: "tag_1",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    expect(toInvoiceListQuery(filter)).toMatchObject({
      status: ["EMITIDA", "VENCIDA"],
      clientId: ["cli_1"],
      projectId: ["prj_1"],
      currency: ["USD"],
      tagId: ["tag_1"],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
  });

  it("maps includeArchived to archived=include and drops a sort outside the contract", () => {
    const filter = invoiceFiltersSchema.parse({ includeArchived: true });
    expect(toInvoiceListQuery(filter).archived).toBe("include");
    expect(toInvoiceListQuery({ ...filter, sort: "nope:asc" as never })).not.toHaveProperty("sort");
  });
});
