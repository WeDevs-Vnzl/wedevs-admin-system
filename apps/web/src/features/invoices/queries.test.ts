import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { InvoiceListResponseDto, InvoiceResponseDto } from "@/lib/api/types/invoices";
import type { BillableInstallmentRow } from "@/lib/validators/invoices";
import { getInvoice, getInvoicesOverview, listBillableInstallments, listInvoices } from "./queries";
import { invoiceListItem, invoicePage, multiRateInvoice } from "./test-data";

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listInvoices", () => {
  it("sends the facets as flat keys (client, project, tag) and archived=exclude by default", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/invoices": { body: invoicePage([invoiceListItem()]) },
    });
    const page = await listInvoices({
      clientId: ["cli_1"],
      projectId: ["prj_1"],
      tagId: ["tag_1"],
      pageSize: 100,
      sort: "issueDate:desc",
    });
    expect(page.items[0]?.invoiceNumber).toBe("00001234");
    const search = calls[0]?.search;
    expect(search?.getAll("clientId")).toEqual(["cli_1"]);
    expect(search?.getAll("projectId")).toEqual(["prj_1"]);
    expect(search?.getAll("tagId")).toEqual(["tag_1"]);
    expect(search?.get("pageSize")).toBe("100");
    expect(search?.get("sort")).toBe("issueDate:desc");
    expect(search?.get("archived")).toBe("exclude");
  });

  it("asks for archived rows only when the table toggle is on", async () => {
    const { calls } = useRoutes({ "GET /api/v1/invoices": { body: invoicePage([]) } });
    await listInvoices({ includeArchived: true });
    expect(calls[0]?.search.get("archived")).toBe("include");
  });

  it("throws ServiceError FORBIDDEN when the BE refuses the role (Member, Viewer)", async () => {
    useRoutes({ "GET /api/v1/invoices": errorEnvelope("FORBIDDEN") });
    await expect(listInvoices()).rejects.toMatchObject({ name: "ServiceError", code: "FORBIDDEN" });
  });
});

describe("getInvoicesOverview (Q-FEINT-8 (A), DT-175)", () => {
  const overview = {
    billedVsCollected: { periods: ["2026-10"], series: [{ id: "billed", values: ["2000.01"] }] },
    aging: { d0_30: "0.00", d31_60: "0.00", d61_90: "0.00", d90plus: "0.00" },
    overdueCount: 0,
    totalsByCurrency: [],
  };

  it("reads GET /api/v1/invoices/overview for the Owner", async () => {
    const { calls } = useRoutes({ "GET /api/v1/invoices/overview": { body: overview } });
    expect(await getInvoicesOverview()).toMatchObject({ overdueCount: 0 });
    expect(calls[0]?.path).toBe("/api/v1/invoices/overview");
  });

  it("throws ServiceError FORBIDDEN for a Member", async () => {
    useRoutes({ "GET /api/v1/invoices/overview": errorEnvelope("FORBIDDEN") });
    await expect(getInvoicesOverview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("getInvoice (frozen, rule 11)", () => {
  it("returns the generated InvoiceResponseDto of GET /api/v1/invoices/{id}", async () => {
    const { calls } = useRoutes({ "GET /api/v1/invoices/{id}": { body: multiRateInvoice() } });
    const invoice = await getInvoice("inv_1");
    expect(invoice.totals.total).toBe("2000.01");
    expect(calls[0]?.path).toBe("/api/v1/invoices/inv_1");
  });

  it("maps a BE 404 to ServiceError NOT_FOUND, keeping the message", async () => {
    useRoutes({
      "GET /api/v1/invoices/{id}": errorEnvelope("NOT_FOUND", {
        message: "common.errors.NOT_FOUND",
      }),
    });
    await expect(getInvoice("nope")).rejects.toMatchObject({
      name: "ServiceError",
      code: "NOT_FOUND",
      message: "common.errors.NOT_FOUND",
    });
  });

  it("maps 403 to FORBIDDEN and 422 to VALIDATION with their field errors", async () => {
    useRoutes({ "GET /api/v1/invoices/{id}": errorEnvelope("FORBIDDEN") });
    await expect(getInvoice("inv_1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    useRoutes({
      "GET /api/v1/invoices/{id}": errorEnvelope("VALIDATION", {
        fieldErrors: { id: ["validation.invalidId"] },
      }),
    });
    await expect(getInvoice("inv_1")).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { id: ["validation.invalidId"] },
    });
  });

  it("answers a malformed id like an unknown one, without calling the BE", async () => {
    const { calls } = useRoutes({});
    await expect(getInvoice("../etc")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toHaveLength(0);
  });

  it("holds the frozen signature (type-level)", () => {
    expectTypeOf(getInvoice).parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf(getInvoice).returns.resolves.toEqualTypeOf<InvoiceResponseDto>();
    expectTypeOf(listInvoices).returns.resolves.toEqualTypeOf<InvoiceListResponseDto>();
    // The fields consumers read.
    expectTypeOf<InvoiceResponseDto>().toHaveProperty("client");
    expectTypeOf<InvoiceResponseDto["archivedAt"]>().toEqualTypeOf<string | null>();
  });
});

describe("listBillableInstallments (frozen, item 8)", () => {
  const wire = {
    installment: { type: "INSTALLMENT", id: "ins_1", label: "Anticipo", code: null },
    project: { type: "PROJECT", id: "prj_1", label: "Portal", code: "PRJ-0001" },
    kind: "ANTICIPO",
    label: "Anticipo 40 %",
    currency: "USD",
    amount: "4000.00",
    remainingAmount: "4000.00",
    dueDate: null,
  };

  it("parses the rows through billableInstallmentRowSchema (wire null code → undefined)", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/clients/{id}/billable-installments": { body: [wire] },
    });
    const rows = await listBillableInstallments("cli_1");
    expect(calls[0]?.path).toBe("/api/v1/clients/cli_1/billable-installments");
    expect(rows[0]?.installment).toEqual({ type: "INSTALLMENT", id: "ins_1", label: "Anticipo" });
    expect(rows[0]?.installment.code).toBeUndefined();
    expect(rows[0]?.project.code).toBe("PRJ-0001");
  });

  it("throws ServiceError NOT_FOUND for an unknown client (form-options turns it into an empty wizard)", async () => {
    useRoutes({ "GET /api/v1/clients/{id}/billable-installments": errorEnvelope("NOT_FOUND") });
    await expect(listBillableInstallments("cli_x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("holds the frozen signature (type-level)", () => {
    expectTypeOf(listBillableInstallments).parameters.toEqualTypeOf<[clientId: string]>();
    expectTypeOf(listBillableInstallments).returns.resolves.toEqualTypeOf<
      BillableInstallmentRow[]
    >();
  });
});
