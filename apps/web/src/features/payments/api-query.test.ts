import { describe, expect, it } from "vitest";
import { paymentFiltersSchema } from "@/lib/validators/payments";
import { toPaymentListQuery } from "./api-query";

describe("toPaymentListQuery", () => {
  it("maps the table facets onto the flat keys of GET /payments", () => {
    const query = toPaymentListQuery(
      paymentFiltersSchema.parse({
        page: 2,
        pageSize: 50,
        q: "kairos",
        sort: "amountUsd:desc",
        status: ["CONFIRMADO"],
        clientId: ["cli_1"],
        accountId: ["acc_1"],
        methodId: ["pm_1"],
        currency: ["VES"],
        dateFrom: "2026-10-01",
        dateTo: "2026-10-31",
        hasUnallocated: true,
      }),
    );
    expect(query).toEqual({
      page: 2,
      pageSize: 50,
      q: "kairos",
      sort: "amountUsd:desc",
      status: ["CONFIRMADO"],
      clientId: ["cli_1"],
      accountId: ["acc_1"],
      methodId: ["pm_1"],
      currency: ["VES"],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      hasUnallocated: "true",
    });
  });

  it("sends no archived mode (payments do not archive, DT-122) and no empty facet", () => {
    const query = toPaymentListQuery(paymentFiltersSchema.parse({}));
    expect(query).toEqual({ page: 1, pageSize: 25 });
    expect(query).not.toHaveProperty("archived");
  });

  it("sends hasUnallocated=false as the string the contract expects", () => {
    expect(toPaymentListQuery(paymentFiltersSchema.parse({ hasUnallocated: false }))).toMatchObject(
      { hasUnallocated: "false" },
    );
  });
});
