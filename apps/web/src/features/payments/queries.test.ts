import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  getClientCredit,
  getInvoiceForPayment,
  getPayment,
  getPaymentsOverview,
  listOpenInvoices,
  listPayments,
} from "./queries";
import { makeOpenInvoice, makePayment, makePaymentRow, page } from "./test-fixtures";
import type { OpenInvoiceOption } from "./types";

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const overview = {
  collectedByMonth: [{ period: "2026-10", value: "350.00" }],
  byMethod: [{ key: "pm_zelle", label: "Zelle", value: "350.00" }],
  byAccount: [{ key: "acc_usd", label: "Zelle USD", value: "350.00" }],
  pendingVerificationCount: 2,
  unallocatedCount: 1,
  unallocatedTotalUsd: "97.00",
};

describe("getPaymentsOverview (DT-175)", () => {
  it("reads GET /api/v1/payments/overview for an Owner", async () => {
    const { calls } = useRoutes({ "GET /api/v1/payments/overview": { body: overview } });
    const result = await getPaymentsOverview();
    expect(result.unallocatedTotalUsd).toBe("97.00");
    expect(calls[0]?.path).toBe("/api/v1/payments/overview");
  });

  it("throws ServiceError FORBIDDEN for a Member (C13)", async () => {
    useRoutes({ "GET /api/v1/payments/overview": errorEnvelope("FORBIDDEN") });
    await expect(getPaymentsOverview()).rejects.toMatchObject({
      name: "ServiceError",
      code: "FORBIDDEN",
    });
  });
});

describe("listPayments", () => {
  it("sends the filter as flat query keys and never an archived mode", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/payments": { body: page([makePaymentRow()]) },
    });
    const result = await listPayments({
      clientId: ["cli_1"],
      status: ["CONFIRMADO"],
      hasUnallocated: true,
      pageSize: 100,
      sort: "date:desc",
    });
    expect(result.items).toHaveLength(1);
    const search = calls[0]?.search;
    expect(search?.getAll("clientId")).toEqual(["cli_1"]);
    expect(search?.getAll("status")).toEqual(["CONFIRMADO"]);
    expect(search?.get("hasUnallocated")).toBe("true");
    expect(search?.get("pageSize")).toBe("100");
    expect(search?.get("sort")).toBe("date:desc");
    expect(search?.has("archived")).toBe(false);
  });
});

describe("getPayment", () => {
  it("returns the payment figures as the BE computed them (HU-13 CA2)", async () => {
    useRoutes({ "GET /api/v1/payments/{id}": { body: makePayment() } });
    expect(await getPayment("pay_1")).toMatchObject({
      amount: "100.00",
      igtfAmount: "3.00",
      allocatable: "97.00",
      netCredited: "100.00",
    });
  });

  it("maps 404 to ServiceError NOT_FOUND", async () => {
    useRoutes({ "GET /api/v1/payments/{id}": errorEnvelope("NOT_FOUND") });
    await expect(getPayment("pay_missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers a malformed id as an unknown one, without a call", async () => {
    const { calls } = useRoutes({});
    await expect(getPayment("../etc")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toHaveLength(0);
  });
});

describe("getClientCredit (HU-13 CA5)", () => {
  it("reads GET /api/v1/clients/{id}/credit", async () => {
    const credit = {
      payments: [
        {
          paymentId: "pay_1",
          code: "PAG-0001",
          date: "2026-10-05",
          currency: "USD",
          unallocated: "97.00",
          unallocatedUsd: "97.00",
        },
      ],
      totalUsd: "97.00",
    };
    const { calls } = useRoutes({ "GET /api/v1/clients/{id}/credit": { body: credit } });
    expect(await getClientCredit("cli_1")).toEqual(credit);
    expect(calls[0]?.path).toBe("/api/v1/clients/cli_1/credit");
  });
});

describe("listOpenInvoices", () => {
  it("returns OpenInvoiceOption rows from GET /api/v1/clients/{id}/open-invoices", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/clients/{id}/open-invoices": { body: [makeOpenInvoice()] },
    });
    const rows = await listOpenInvoices("cli_1");
    expect(calls[0]?.path).toBe("/api/v1/clients/cli_1/open-invoices");
    expect(rows).toEqual([
      {
        id: "inv_1",
        code: "FAC-0001",
        invoiceNumber: "00-000001",
        currency: "USD",
        usdRate: "1",
        dueDate: "2026-10-20",
        balance: "300.00",
        status: "EMITIDA",
      },
    ]);
    expectTypeOf(rows).toEqualTypeOf<OpenInvoiceOption[]>();
  });
});

describe("getInvoiceForPayment (DT-133)", () => {
  it("returns the client and the open invoice the payment starts from", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/invoices/{id}/payment-context": {
        body: {
          client: { id: "cli_1", code: "CLI-0001", label: "Kairos Studio (MOCK)", type: "CLIENT" },
          invoice: makeOpenInvoice(),
        },
      },
    });
    const context = await getInvoiceForPayment("inv_1");
    expect(calls[0]?.path).toBe("/api/v1/invoices/inv_1/payment-context");
    expect(context?.client.id).toBe("cli_1");
    expect(context?.invoice).toMatchObject({
      id: "inv_1",
      dueDate: "2026-10-20",
      balance: "300.00",
    });
  });

  it("answers null when the invoice takes no payment (404)", async () => {
    useRoutes({ "GET /api/v1/invoices/{id}/payment-context": errorEnvelope("NOT_FOUND") });
    expect(await getInvoiceForPayment("inv_paid")).toBeNull();
  });

  it("answers null for a malformed id without calling the BE", async () => {
    const { calls } = useRoutes({});
    expect(await getInvoiceForPayment("not an id")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("still throws for a refusal that is not a missing invoice", async () => {
    useRoutes({ "GET /api/v1/invoices/{id}/payment-context": errorEnvelope("FORBIDDEN") });
    await expect(getInvoiceForPayment("inv_1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
