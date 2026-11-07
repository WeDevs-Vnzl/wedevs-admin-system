import { describe, expect, it } from "vitest";
import { documentFilterSchema } from "@/lib/validators/documents";
import { toDocumentListQuery } from "./api-query";

describe("toDocumentListQuery", () => {
  it("sends paging, archived mode and the six link facets as flat keys", () => {
    const query = toDocumentListQuery(
      documentFilterSchema.parse({
        page: "2",
        pageSize: "50",
        q: "contrato",
        sort: "updatedAt:desc",
        clientId: ["c1"],
        contactId: "k1",
        projectId: "p1",
        invoiceId: "i1",
        paymentId: "y1",
        expenseId: "e1",
        includeArchived: "true",
      }),
    );
    expect(query).toEqual({
      page: 2,
      pageSize: 50,
      archived: "include",
      q: "contrato",
      sort: "updatedAt:desc",
      clientId: ["c1"],
      contactId: ["k1"],
      projectId: ["p1"],
      invoiceId: ["i1"],
      paymentId: ["y1"],
      expenseId: ["e1"],
    });
  });

  it("serializes the overview shortcuts the way the BE reads them", () => {
    const query = toDocumentListQuery(
      documentFilterSchema.parse({ expiringWithinDays: "30", shared: "false", staleDraft: "true" }),
    );
    expect(query).toMatchObject({
      archived: "exclude",
      expiringWithinDays: "30",
      shared: "false",
      staleDraft: "true",
    });
  });

  it("keeps a sort token the BE knows", () => {
    const query = toDocumentListQuery(documentFilterSchema.parse({ sort: "code:asc" }));
    expect(query.sort).toBe("code:asc");
  });
});
