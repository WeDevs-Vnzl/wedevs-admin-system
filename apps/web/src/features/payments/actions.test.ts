import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { CreatePaymentDto, UpdatePaymentDto } from "@/lib/api/types/payments";
import type { ActionResult, EntityRef } from "@/lib/validators/common";
import { listQuerySchema } from "@/lib/validators/common";
import {
  allocatePaymentAction,
  createPaymentAction,
  deallocatePaymentAction,
  detectDuplicatePaymentAction,
  listOpenInvoicesAction,
  listPaymentsAction,
  searchPaymentsAction,
  setPaymentStatusAction,
  updatePaymentAction,
} from "./actions";
import { paymentFilterOf } from "./components/payment-table-query";
import { makeOpenInvoice, makePayment, makePaymentRow, page } from "./test-fixtures";
import type { OpenInvoiceOption } from "./types";

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  mocks.getServerApi.mockReset();
  mocks.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const createBody: CreatePaymentDto = {
  clientId: "cli_1",
  date: "2026-10-05",
  accountId: "acc_ves",
  methodId: "pm_transfer",
  currency: "VES",
  amount: "3650.00",
  igtfAmount: "0.00",
  feeAmount: "0.00",
  usdRate: "36.5",
  reference: "TR-MOCK-1",
  receiptFileId: "fil_1",
  status: "CONFIRMADO",
  allocations: [
    { invoiceId: "inv_1", amountPaymentCurrency: "3650.00", amountInvoiceCurrency: "99.00" },
  ],
};

// `UpdatePaymentDto` has no allocations and no status (DT-213).
const fields: UpdatePaymentDto = {
  clientId: createBody.clientId,
  date: createBody.date,
  accountId: createBody.accountId,
  methodId: createBody.methodId,
  currency: createBody.currency,
  amount: createBody.amount,
  igtfAmount: createBody.igtfAmount,
  feeAmount: createBody.feeAmount,
  usdRate: createBody.usdRate,
  reference: createBody.reference,
  receiptFileId: createBody.receiptFileId,
};

describe("listPaymentsAction", () => {
  it("sends the facets, the search and the sort of the table query as flat keys", async () => {
    const { calls } = useRoutes({ "GET /api/v1/payments": { body: page([makePaymentRow()]) } });
    const result = await listPaymentsAction(
      paymentFilterOf(
        listQuerySchema.parse({
          sort: "amountUsd:desc",
          q: "kairos",
          filters: {
            status: ["CONFIRMADO"],
            currency: ["VES"],
            date: ["2026-10-01", "2026-10-31"],
            hasUnallocated: ["true"],
          },
        }),
      ),
    );
    expect(result).toMatchObject({ ok: true, data: { total: 1 } });
    const search = calls[0]?.search;
    expect(search?.get("sort")).toBe("amountUsd:desc");
    expect(search?.get("q")).toBe("kairos");
    expect(search?.getAll("status")).toEqual(["CONFIRMADO"]);
    expect(search?.get("dateFrom")).toBe("2026-10-01");
    expect(search?.get("dateTo")).toBe("2026-10-31");
    expect(search?.get("hasUnallocated")).toBe("true");
  });

  it("rejects a sort outside the whitelist with VALIDATION before any call", async () => {
    const { calls } = useRoutes({});
    expect(await listPaymentsAction({ sort: "client:asc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });

  it.each(["MEMBER", "VIEWER"])("returns FORBIDDEN for a %s (C13: the BE decides)", async () => {
    useRoutes({ "GET /api/v1/payments": errorEnvelope("FORBIDDEN") });
    expect(await listPaymentsAction({ page: 1, pageSize: 25 })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("createPaymentAction (HU-13)", () => {
  it("sends both amounts of every allocation as typed and the receipt file id (CA4, HU-14 CA1)", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/payments": { status: 201, body: makePayment({ currency: "VES" }) },
    });
    const result = await createPaymentAction(createBody);
    expect(result).toMatchObject({ ok: true, data: { code: "PAG-0001" } });
    expect(calls[0]?.body).toEqual(createBody);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/payments", "layout");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/invoices", "layout");
  });

  it("returns the response's figures (CA2: 100 / IGTF 3 / fee 0 → allocatable 97, net 100)", async () => {
    useRoutes({ "POST /api/v1/payments": { status: 201, body: makePayment() } });
    const result = await createPaymentAction({ ...createBody, currency: "USD", usdRate: "1" });
    expect(result).toMatchObject({
      ok: true,
      data: { amount: "100.00", igtfAmount: "3.00", allocatable: "97.00", netCredited: "100.00" },
    });
  });

  it("maps an over-allocation 422 at its path (CA3)", async () => {
    useRoutes({
      "POST /api/v1/payments": errorEnvelope("VALIDATION", {
        fieldErrors: { allocations: ["payments.validation.allocationsExceedAllocatable"] },
      }),
    });
    expect(await createPaymentAction(createBody)).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { allocations: ["payments.validation.allocationsExceedAllocatable"] },
      },
    });
  });

  it("maps an unknown receipt to NOT_FOUND", async () => {
    useRoutes({ "POST /api/v1/payments": errorEnvelope("NOT_FOUND") });
    expect(await createPaymentAction(createBody)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("updatePaymentAction (DT-213)", () => {
  it("PATCHes the payment fields without the id in the body", async () => {
    const { calls } = useRoutes({
      "PATCH /api/v1/payments/{id}": { body: makePayment({ reference: "NEW" }) },
    });
    const result = await updatePaymentAction({ id: "pay_1", ...fields });
    expect(result).toMatchObject({ ok: true });
    expect(calls[0]?.path).toBe("/api/v1/payments/pay_1");
    expect(calls[0]?.body).toEqual(fields);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/payments/pay_1", "page");
  });

  it("keeps the INTEGRITY_LOCK of a client change with live allocations", async () => {
    useRoutes({
      "PATCH /api/v1/payments/{id}": errorEnvelope("INTEGRITY_LOCK", {
        message: "payments.errors.clientLocked",
      }),
    });
    expect(await updatePaymentAction({ id: "pay_1", ...fields, clientId: "cli_2" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "payments.errors.clientLocked" },
    });
  });
});

describe("setPaymentStatusAction (DT-213)", () => {
  it("confirms a pending payment", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/payments/{id}/status": { body: makePayment({ status: "CONFIRMADO" }) },
    });
    const result = await setPaymentStatusAction({ id: "pay_1", status: "CONFIRMADO" });
    expect(result).toMatchObject({ ok: true, data: { status: "CONFIRMADO" } });
    expect(calls[0]?.path).toBe("/api/v1/payments/pay_1/status");
    expect(calls[0]?.body).toEqual({ status: "CONFIRMADO" });
  });

  it("maps the limits recheck of a confirmation to its 422", async () => {
    useRoutes({
      "POST /api/v1/payments/{id}/status": errorEnvelope("VALIDATION", {
        fieldErrors: { allocations: ["payments.validation.allocationsExceedAllocatable"] },
      }),
    });
    expect(await setPaymentStatusAction({ id: "pay_1", status: "CONFIRMADO" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("voids with a reason and returns the payment without its allocations", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/payments/{id}/status": {
        body: makePayment({ status: "ANULADO", allocations: [], allocated: "0.00" }),
      },
    });
    const result = await setPaymentStatusAction({
      id: "pay_1",
      status: "ANULADO",
      reason: "Duplicated deposit",
    });
    expect(result).toMatchObject({ ok: true, data: { status: "ANULADO", allocations: [] } });
    expect(calls[0]?.body).toEqual({ status: "ANULADO", reason: "Duplicated deposit" });
  });
});

describe("allocate and deallocate (HU-13 CA5)", () => {
  const allocation = {
    id: "alc_1",
    paymentId: "pay_1",
    invoice: { id: "inv_1", code: "FAC-0001", label: "FAC-0001", type: "INVOICE" as const },
    invoiceCurrency: "USD",
    amountPaymentCurrency: "50.00",
    amountInvoiceCurrency: "50.00",
    amountUsd: "50.00",
    createdAt: "2026-10-06T12:00:00.000Z",
  };

  it("POSTs one allocation with both amounts to the payment", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/payments/{id}/allocations": { status: 201, body: allocation },
    });
    const result = await allocatePaymentAction({
      paymentId: "pay_1",
      invoiceId: "inv_1",
      amountPaymentCurrency: "50.00",
      amountInvoiceCurrency: "50.00",
    });
    expect(result).toMatchObject({ ok: true, data: { id: "alc_1" } });
    expect(calls[0]?.path).toBe("/api/v1/payments/pay_1/allocations");
    expect(calls[0]?.body).toEqual({
      invoiceId: "inv_1",
      amountPaymentCurrency: "50.00",
      amountInvoiceCurrency: "50.00",
    });
  });

  it("maps a duplicate live allocation to CONFLICT at its path", async () => {
    useRoutes({
      "POST /api/v1/payments/{id}/allocations": errorEnvelope("CONFLICT", {
        fieldErrors: {
          "allocations.0.invoiceId": ["payments.validation.duplicateInvoiceAllocation"],
        },
      }),
    });
    expect(
      await allocatePaymentAction({
        paymentId: "pay_1",
        invoiceId: "inv_1",
        amountPaymentCurrency: "50.00",
        amountInvoiceCurrency: "50.00",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        fieldErrors: {
          "allocations.0.invoiceId": ["payments.validation.duplicateInvoiceAllocation"],
        },
      },
    });
  });

  it("deallocates through POST /allocations/{id}/deallocate and refreshes the payment page", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/allocations/{id}/deallocate": { body: makePayment() },
    });
    const result = await deallocatePaymentAction({ allocationId: "alc_1" });
    expect(result).toMatchObject({ ok: true, data: { id: "pay_1" } });
    expect(calls[0]?.path).toBe("/api/v1/allocations/alc_1/deallocate");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/payments", "layout");
  });
});

describe("detectDuplicatePaymentAction (HU-13 CA6)", () => {
  it("passes method, account and reference, and excludePaymentId when editing", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/payments/duplicates": { body: { duplicate: false, matches: [] } },
    });
    const result = await detectDuplicatePaymentAction({
      methodId: "pm_1",
      accountId: "acc_1",
      reference: "REF-1",
      excludePaymentId: "pay_1",
    });
    expect(result).toMatchObject({ ok: true, data: { duplicate: false } });
    const search = calls[0]?.search;
    expect(search?.get("methodId")).toBe("pm_1");
    expect(search?.get("accountId")).toBe("acc_1");
    expect(search?.get("reference")).toBe("REF-1");
    expect(search?.get("excludePaymentId")).toBe("pay_1");
  });

  it("omits excludePaymentId when creating", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/payments/duplicates": { body: { duplicate: false, matches: [] } },
    });
    await detectDuplicatePaymentAction({
      methodId: "pm_1",
      accountId: "acc_1",
      reference: "REF-1",
    });
    expect(calls[0]?.search.has("excludePaymentId")).toBe(false);
  });
});

describe("listOpenInvoicesAction", () => {
  it("returns the client's open invoices as OpenInvoiceOption", async () => {
    useRoutes({ "GET /api/v1/clients/{id}/open-invoices": { body: [makeOpenInvoice()] } });
    const result = await listOpenInvoicesAction({ clientId: "cli_1" });
    expect(result).toMatchObject({
      ok: true,
      data: [{ id: "inv_1", dueDate: "2026-10-20", balance: "300.00" }],
    });
    expectTypeOf(listOpenInvoicesAction).toEqualTypeOf<
      (input: { clientId: string }) => Promise<ActionResult<OpenInvoiceOption[]>>
    >();
  });

  it("rejects a malformed client id with VALIDATION and no call", async () => {
    const { calls } = useRoutes({});
    expect(await listOpenInvoicesAction({ clientId: "no id" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });
});

describe("searchPaymentsAction (note link picker, frozen)", () => {
  it("keeps the first 20 of 25 rows as EntityRef with no null code", async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      makePaymentRow({ id: `pay_${index}`, code: `PAG-${String(index).padStart(4, "0")}` }),
    );
    const { calls } = useRoutes({ "GET /api/v1/payments": { body: page(rows) } });
    const result = await searchPaymentsAction({ q: "PAG" });
    expect(calls[0]?.search.get("q")).toBe("PAG");
    expect(calls[0]?.search.get("pageSize")).toBe("25");
    expect(result.ok && result.data).toHaveLength(20);
    expect(result.ok && result.data[0]).toEqual({
      type: "PAYMENT",
      id: "pay_0",
      code: "PAG-0000",
      label: "PAG-0000",
    });
    expect(result.ok && result.data.every((ref) => ref.code !== null)).toBe(true);
  });

  it("maps a role the BE refuses to FORBIDDEN", async () => {
    useRoutes({ "GET /api/v1/payments": errorEnvelope("FORBIDDEN") });
    expect(await searchPaymentsAction({ q: "" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("keeps its frozen signature: ({ q }) → ActionResult<EntityRef[]>", () => {
    expectTypeOf(searchPaymentsAction).toEqualTypeOf<
      (input: { q?: string | undefined }) => Promise<ActionResult<EntityRef[]>>
    >();
  });
});
