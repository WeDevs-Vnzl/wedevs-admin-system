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
import type { InvoiceListResponseDto } from "@/lib/api/types/invoices";
import { listQuerySchema, type ActionResult, type EntityRef } from "@/lib/validators/common";
import type { BillableInstallmentRow, CreateInvoiceInput } from "@/lib/validators/invoices";
import {
  archiveInvoiceAction,
  attachInvoiceFileAction,
  createInvoiceAction,
  issueDraftAction,
  listBillableInstallmentsAction,
  listInvoicesAction,
  restoreInvoiceAction,
  searchInvoicesAction,
  updateInvoiceAction,
  voidInvoiceAction,
} from "./actions";
import { invoiceFilterOf } from "./components/invoice-table-query";
import { invoiceListItem, invoicePage, multiRateInvoice } from "./test-data";

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

/** HU-11: 1000 at 16 %, 500 at 8 %, 200 at 0 % and 100 exempt, with a ±0.01 adjustment on 16 %. */
function multiRateInput(adjustment: string): CreateInvoiceInput {
  const line = (description: string, unitPrice: string, ivaRate: string | null) => ({
    description,
    quantity: "1",
    unitPrice,
    discount: "0",
    ivaRate,
  });
  return {
    clientId: "cli_1",
    invoiceNumber: "00001234",
    controlNumber: undefined,
    issueDate: "2026-10-09",
    dueDate: "2026-10-24",
    currency: "USD",
    usdRate: "1",
    bcvRate: undefined,
    lines: [
      { ...line("Desarrollo MVP", "1000.00", "16"), projectId: "prj_1" },
      line("Soporte", "500.00", "8"),
      line("Exportación", "200.00", "0"),
      line("Hosting exento", "100.00", null),
    ],
    taxAdjustments: [{ ivaRate: "16", adjustment }],
    ivaWithheld: "0",
    islrWithheld: "0",
    otherWithheld: "0",
    otherWithheldNote: undefined,
    fileId: undefined,
    isDraft: true,
  } as CreateInvoiceInput;
}

describe("createInvoiceAction (HU-11, C17)", () => {
  it("posts the per-line rates (incl. exempt null) and the ±0.01 adjustment; the response carries the totals", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/invoices": { status: 201, body: multiRateInvoice() },
    });
    const result = await createInvoiceAction(multiRateInput("0.01"));

    expect(result).toMatchObject({ ok: true, data: { totals: { total: "2000.01" } } });
    const body = calls[0]?.body as {
      lines: { ivaRate: string | null }[];
      taxAdjustments: unknown[];
    };
    expect(body.lines.map((line) => line.ivaRate)).toEqual(["16", "8", "0", null]);
    expect(body.taxAdjustments).toEqual([{ ivaRate: "16", adjustment: "0.01" }]);
    expect(calls[0]?.body).toMatchObject({
      clientId: "cli_1",
      invoiceNumber: "00001234",
      isDraft: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/invoices");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/invoices/list");
  });

  it("maps the BE 422 of a 0.02 adjustment to VALIDATION at its path", async () => {
    useRoutes({
      "POST /api/v1/invoices": errorEnvelope("VALIDATION", {
        fieldErrors: {
          "taxAdjustments.0.adjustment": ["invoices.validation.adjustmentOutOfRange"],
        },
      }),
    });
    const result = await createInvoiceAction(multiRateInput("0.02"));
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: {
          "taxAdjustments.0.adjustment": ["invoices.validation.adjustmentOutOfRange"],
        },
      },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a taken number to CONFLICT with the entity and fieldErrors.invoiceNumber", async () => {
    useRoutes({
      "POST /api/v1/invoices": errorEnvelope("CONFLICT", {
        message: "invoices.errors.numberTaken",
        fieldErrors: { invoiceNumber: ["invoices.errors.numberTaken"] },
        entity: { type: "INVOICE", id: "inv_9", code: "FAC-0009", label: "00001234" },
      }),
    });
    const result = await createInvoiceAction(multiRateInput("0"));
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "invoices.errors.numberTaken",
        fieldErrors: { invoiceNumber: ["invoices.errors.numberTaken"] },
        entity: { id: "inv_9", code: "FAC-0009" },
      },
    });
  });

  it("maps FORBIDDEN for a Member and never throws", async () => {
    useRoutes({ "POST /api/v1/invoices": errorEnvelope("FORBIDDEN") });
    expect(await createInvoiceAction(multiRateInput("0"))).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("updateInvoiceAction", () => {
  it("patches /invoices/{id} with the id in the path only and keeps the line ids", async () => {
    const { calls } = useRoutes({ "PATCH /api/v1/invoices/{id}": { body: multiRateInvoice() } });
    const input = multiRateInput("0.01");
    input.lines[0] = { ...input.lines[0]!, id: "l1" };
    await updateInvoiceAction({ ...input, id: "inv_1" });
    expect(calls[0]?.path).toBe("/api/v1/invoices/inv_1");
    expect(calls[0]?.body).not.toHaveProperty("id");
    expect((calls[0]?.body as { lines: { id?: string }[] }).lines[0]?.id).toBe("l1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/invoices/inv_1");
  });
});

describe("issue, void, archive, restore (HU-12, DT-128, DT-133)", () => {
  it("issues a draft through POST /invoices/{id}/issue", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/invoices/{id}/issue": {
        body: multiRateInvoice({ isDraft: false, status: "EMITIDA" }),
      },
    });
    expect(await issueDraftAction({ id: "inv_1" })).toMatchObject({
      ok: true,
      data: { status: "EMITIDA" },
    });
    expect(calls[0]?.path).toBe("/api/v1/invoices/inv_1/issue");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/invoices/inv_1");
  });

  it("voids with the reason as the body", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/invoices/{id}/void": { body: multiRateInvoice({ status: "ANULADA" }) },
    });
    await voidInvoiceAction({ id: "inv_1", reason: "Duplicada" });
    expect(calls[0]?.body).toEqual({ reason: "Duplicada" });
  });

  it("maps the void refusals: archived (DT-128) and allocated payments (INTEGRITY_LOCK) keep their keys", async () => {
    useRoutes({
      "POST /api/v1/invoices/{id}/void": errorEnvelope("INTEGRITY_LOCK", {
        message: "invoices.errors.hasAllocations",
      }),
      "POST /api/v1/invoices/{id}/issue": errorEnvelope("VALIDATION", {
        message: "invoices.errors.archived",
      }),
    });
    expect(await voidInvoiceAction({ id: "inv_1", reason: "x" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "invoices.errors.hasAllocations" },
    });
    expect(await issueDraftAction({ id: "inv_1" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", message: "invoices.errors.archived" },
    });
  });

  it("archives and restores through their POST routes", async () => {
    const { calls } = useRoutes({
      "POST /api/v1/invoices/{id}/archive": {
        body: multiRateInvoice({ archivedAt: "2026-10-10T00:00:00.000Z" }),
      },
      "POST /api/v1/invoices/{id}/restore": {
        body: {
          entity: { type: "INVOICE", id: "inv_1", label: "00001234", code: "FAC-0001" },
          restoredAt: "2026-10-11T00:00:00.000Z",
        },
      },
    });
    expect(await archiveInvoiceAction({ id: "inv_1" })).toMatchObject({ ok: true });
    expect(await restoreInvoiceAction({ id: "inv_1" })).toMatchObject({ ok: true });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/invoices/inv_1/archive",
      "/api/v1/invoices/inv_1/restore",
    ]);
  });

  it("maps a restore CONFLICT (client archived) keeping its trash key", async () => {
    useRoutes({
      "POST /api/v1/invoices/{id}/restore": errorEnvelope("CONFLICT", {
        message: "trash.errors.clientArchived",
      }),
    });
    expect(await restoreInvoiceAction({ id: "inv_1" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "trash.errors.clientArchived" },
    });
  });
});

describe("attachInvoiceFileAction (C23)", () => {
  it("puts the confirmed fileId on /invoices/{id}/file and detaches with null", async () => {
    const { calls } = useRoutes({ "PUT /api/v1/invoices/{id}/file": { body: multiRateInvoice() } });
    await attachInvoiceFileAction({ id: "inv_1", fileId: "fil_1" });
    await attachInvoiceFileAction({ id: "inv_1", fileId: null });
    expect(calls.map((call) => call.body)).toEqual([{ fileId: "fil_1" }, { fileId: null }]);
    expect(calls[0]?.path).toBe("/api/v1/invoices/inv_1/file");
  });
});

describe("listInvoicesAction", () => {
  const tableQuery = (input: Record<string, unknown>) =>
    invoiceFilterOf(listQuerySchema.parse(input));

  it("sends the table facets and the header sort", async () => {
    const { calls } = useRoutes({
      "GET /api/v1/invoices": { body: invoicePage([invoiceListItem()]) },
    });
    const result = await listInvoicesAction(
      tableQuery({ sort: "invoiceNumber:asc", filters: { clientId: ["cli_1"] } }),
    );
    expect(result).toMatchObject({ ok: true, data: { total: 1 } });
    expect(calls[0]?.search.get("sort")).toBe("invoiceNumber:asc");
    expect(calls[0]?.search.getAll("clientId")).toEqual(["cli_1"]);
  });

  it("answers FORBIDDEN for a Member (the list shows the no-permission state)", async () => {
    useRoutes({ "GET /api/v1/invoices": errorEnvelope("FORBIDDEN") });
    expect(await listInvoicesAction({})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("holds its result type", () => {
    expectTypeOf(listInvoicesAction).returns.resolves.toEqualTypeOf<
      ActionResult<InvoiceListResponseDto>
    >();
  });
});

describe("searchInvoicesAction (frozen, rule 12)", () => {
  it("lists with pageSize 25 and keeps the first 20 as EntityRef (null code → undefined)", async () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      invoiceListItem({
        id: `inv_${index}`,
        code: `FAC-${String(index).padStart(4, "0")}`,
        invoiceNumber: `N-${index}`,
      }),
    );
    const { calls } = useRoutes({ "GET /api/v1/invoices": { body: invoicePage(items) } });
    const result = await searchInvoicesAction({ q: "N-" });

    expect(result.ok && result.data).toHaveLength(20);
    expect(result.ok && result.data[0]).toEqual({
      type: "INVOICE",
      id: "inv_0",
      code: "FAC-0000",
      label: "N-0",
    });
    expect(calls[0]?.search.get("pageSize")).toBe("25");
    expect(calls[0]?.search.get("q")).toBe("N-");
    expect(calls[0]?.search.get("archived")).toBe("exclude");
  });

  it("holds the frozen signature (type-level)", () => {
    expectTypeOf(searchInvoicesAction).parameters.toEqualTypeOf<[input: { q?: string }]>();
    expectTypeOf(searchInvoicesAction).returns.resolves.toEqualTypeOf<ActionResult<EntityRef[]>>();
  });
});

describe("listBillableInstallmentsAction (frozen, item 8)", () => {
  it("parses the wire rows (null code → undefined) for the wizard", async () => {
    useRoutes({
      "GET /api/v1/clients/{id}/billable-installments": {
        body: [
          {
            installment: { type: "INSTALLMENT", id: "ins_1", label: "Anticipo", code: null },
            project: { type: "PROJECT", id: "prj_1", label: "Portal", code: null },
            kind: "ANTICIPO",
            label: "Anticipo 40 %",
            currency: "USD",
            amount: "4000.00",
            remainingAmount: "3000.00",
            dueDate: "2026-11-01",
          },
        ],
      },
    });
    const result = await listBillableInstallmentsAction({ clientId: "cli_1" });
    expect(result).toMatchObject({ ok: true, data: [{ remainingAmount: "3000.00" }] });
    expect(result.ok && result.data[0]?.installment.code).toBeUndefined();
  });

  it("holds the frozen signature (type-level)", () => {
    expectTypeOf(listBillableInstallmentsAction).parameters.toEqualTypeOf<
      [input: { clientId: string }]
    >();
    expectTypeOf(listBillableInstallmentsAction).returns.resolves.toEqualTypeOf<
      ActionResult<BillableInstallmentRow[]>
    >();
  });
});
