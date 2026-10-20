import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInvoiceInputSchema,
  ivaAdjustmentSchema,
  updateInvoiceInputSchema,
  voidInvoiceInputSchema,
  type InvoiceDetailDTO,
} from "@/lib/validators/invoices";
import { ServiceError } from "../ctx";
import { makeAllocation, makePayment, ref } from "../finance-test-factories";
import { mockId } from "../ids";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import {
  archiveInvoice,
  attachInvoiceFile,
  createInvoice,
  getInvoice,
  getInvoicesOverview,
  INVOICE_FILE_MAX_BYTES,
  issueDraft,
  listBillableInstallments,
  listInvoices,
  updateInvoice,
  voidInvoice,
} from "./invoices";

// Seed of the invoices fixtures, today = 2026-10-09 (FIXED_NOW): `kairos_partial` EMITIDA with receivable 1 392.00,
// `kairos_paid` receivable 500.00, `kairos_overdue` VENCIDA, `zafiro_multi_rate` with lines at 16 %, 8 %, 0 % and
// exempt and a +0.01 adjustment on 8 %. The clock is pinned so the derive pass (which reads the clock) agrees with
// the tests.

const PARTIAL = mockId("inv", "kairos_partial");
const PAID = mockId("inv", "kairos_paid");
const OVERDUE = mockId("inv", "kairos_overdue");
const MULTI = mockId("inv", "zafiro_multi_rate");
const KAIROS = mockId("cli", "kairos");
const ZAFIRO = mockId("cli", "zafiro_labs");
const WEB_1 = mockId("ins", "kairos_web_1");
const WEB_2 = mockId("ins", "kairos_web_2");

let ctx: ReturnType<typeof makeTestContext>["ctx"];
let db: ReturnType<typeof makeTestContext>["db"];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  ({ ctx, db } = makeTestContext("OWNER"));
});

afterEach(() => {
  vi.useRealTimers();
});

/** A create input before parsing, for the cases that assert the schema itself. */
function rawCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: ZAFIRO,
    invoiceNumber: "NEW-0001",
    issueDate: "2026-10-09",
    dueDate: "2026-11-08",
    currency: "USD",
    usdRate: "1",
    lines: [{ description: "Servicio de prueba", unitPrice: "100.00", ivaRate: "16" }],
    ...overrides,
  };
}

/** A valid create input, parsed by the same schema the action uses. */
function createInput(overrides: Record<string, unknown> = {}) {
  return createInvoiceInputSchema.parse(rawCreateInput(overrides));
}

/** An update input rebuilt from a stored invoice, so the test changes one field at a time. */
function updateInputOf(invoice: InvoiceDetailDTO, overrides: Record<string, unknown> = {}) {
  return updateInvoiceInputSchema.parse({
    id: invoice.id,
    clientId: invoice.client.id,
    invoiceNumber: invoice.invoiceNumber,
    controlNumber: invoice.controlNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    usdRate: invoice.usdRate,
    isDraft: invoice.isDraft,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      projectId: line.project?.id,
      installmentId: line.installment?.id,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ivaRate: line.ivaRate,
    })),
    taxAdjustments: invoice.taxLines
      .filter((line) => line.adjustment !== "0.00")
      .map((line) => ({ ivaRate: line.ivaRate, adjustment: line.adjustment })),
    ivaWithheld: invoice.totals.ivaWithheld,
    islrWithheld: invoice.totals.islrWithheld,
    otherWithheld: invoice.totals.otherWithheld,
    ...overrides,
  });
}

/** Adds a confirmed payment and its allocation to an invoice, then lets the derive pass see them. */
function allocate(invoiceId: string, amount: string, paymentId = `pag_${invoiceId}`) {
  db.payments.push(
    makePayment({
      id: paymentId,
      status: "CONFIRMADO",
      amount,
      igtfAmount: "0.00",
      feeAmount: "0.00",
      client: ref(KAIROS, "CLIENT"),
    }),
  );
  db.paymentAllocations.push(
    makeAllocation({
      id: `alo_${paymentId}`,
      paymentId,
      invoice: ref(invoiceId, "INVOICE"),
      amountPaymentCurrency: amount,
      amountInvoiceCurrency: amount,
      amountUsd: amount,
    }),
  );
}

describe("derived status (HU-12)", () => {
  it("CA1: an invoice without payments that is not overdue is EMITIDA", async () => {
    // The seeded PARTIAL invoice already carries PAG-0001 (T7), so a fresh invoice stands in for "no payments".
    const created = await createInvoice(ctx, createInput());
    const invoice = await getInvoice(ctx, created.id);
    expect(invoice.status).toBe("EMITIDA");
    expect(invoice.totals.paidAmount).toBe("0.00");
    expect(invoice.totals.balance).toBe("116.00");
  });

  it("CA2: a confirmed payment below the balance makes it PARCIAL", async () => {
    allocate(PARTIAL, "300.00");
    const invoice = await getInvoice(ctx, PARTIAL);
    expect(invoice.status).toBe("PARCIAL");
    expect(invoice.totals.balance).toBe("1092.00");
  });

  it("CA3: a balance of 0.01 or less makes it PAGADA", async () => {
    allocate(PAID, "499.99");
    expect((await getInvoice(ctx, PAID)).status).toBe("PAGADA");
  });

  it("CA4: an invoice past its due date with a balance is VENCIDA", async () => {
    const invoice = await getInvoice(ctx, OVERDUE);
    expect(invoice.status).toBe("VENCIDA");
    expect(invoice.daysOverdue).toBeGreaterThan(0);
  });

  it("CA5: voiding requires a reason and is refused while allocations are active", async () => {
    expect(voidInvoiceInputSchema.safeParse({ id: PAID }).success).toBe(false);

    allocate(PAID, "100.00");
    await expect(voidInvoice(ctx, { id: PAID, reason: "Error de cliente" })).rejects.toMatchObject({
      code: "INTEGRITY_LOCK",
    });

    db.paymentAllocations.splice(0);
    const voided = await voidInvoice(ctx, { id: PAID, reason: "Error de cliente" });
    expect(voided.status).toBe("ANULADA");
    expect(voided.voidReason).toBe("Error de cliente");
    await expect(voidInvoice(ctx, { id: PAID, reason: "Otra vez" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("line grid and per-rate totals (S2, DT-44)", () => {
  it("the multi-rate seed has per-rate bases and IVA that match C17", async () => {
    const invoice = await getInvoice(ctx, MULTI);
    expect(invoice.totals).toMatchObject({
      subtotal: "2000.00",
      discount: "100.00",
      exemptAmount: "300.00",
      taxBase: "1600.00",
      ivaAmount: "184.01",
      total: "2084.01",
      receivable: "2084.01",
    });
    expect(invoice.taxLines).toEqual([
      expect.objectContaining({ ivaRate: "16", taxBase: "900.00", ivaAmount: "144.00" }),
      expect.objectContaining({ ivaRate: "8", taxBase: "500.00", ivaAmount: "40.01" }),
      expect.objectContaining({ ivaRate: "0", taxBase: "200.00", ivaAmount: "0.00" }),
    ]);
  });

  it("±0.01 adjustment accepted and 0.02 rejected", () => {
    expect(ivaAdjustmentSchema.safeParse({ ivaRate: "16", adjustment: "0.01" }).success).toBe(true);
    expect(ivaAdjustmentSchema.safeParse({ ivaRate: "16", adjustment: "-0.01" }).success).toBe(
      true,
    );
    expect(ivaAdjustmentSchema.safeParse({ ivaRate: "16", adjustment: "0.02" }).success).toBe(
      false,
    );
  });

  it("a +0.01 adjustment on a rate is added to that rate's IVA", async () => {
    const created = await createInvoice(
      ctx,
      createInput({
        lines: [{ description: "Servicio", unitPrice: "100.00", ivaRate: "16" }],
        taxAdjustments: [{ ivaRate: "16", adjustment: "0.01" }],
      }),
    );
    expect(created.taxLines[0]).toMatchObject({ taxBase: "100.00", ivaAmount: "16.01" });
    expect(created.totals.total).toBe("116.01");
  });

  it("an adjustment of 0.02 cannot reach the service through the schema", () => {
    expect(
      createInvoiceInputSchema.safeParse(
        rawCreateInput({ taxAdjustments: [{ ivaRate: "16", adjustment: "0.02" }] }),
      ).success,
    ).toBe(false);
  });

  it("lines at 16 %, 8 %, 0 % and exempt with line discounts", async () => {
    const created = await createInvoice(
      ctx,
      createInput({
        lines: [
          {
            description: "A",
            quantity: "2",
            unitPrice: "100.00",
            discount: "20.00",
            ivaRate: "16",
          },
          { description: "B", unitPrice: "50.00", ivaRate: "8" },
          { description: "C", unitPrice: "30.00", ivaRate: "0" },
          { description: "D", unitPrice: "10.00", ivaRate: null },
        ],
      }),
    );
    expect(created.totals).toMatchObject({
      subtotal: "290.00",
      discount: "20.00",
      exemptAmount: "10.00",
      taxBase: "260.00",
      ivaAmount: "32.80",
      total: "302.80",
    });
    expect(created.lines[0]).toMatchObject({ amount: "200.00", netAmount: "180.00" });
  });

  it("a line discount above its amount is rejected by the schema", () => {
    expect(
      createInvoiceInputSchema.safeParse(
        rawCreateInput({
          lines: [{ description: "A", unitPrice: "10.00", discount: "11.00", ivaRate: "16" }],
        }),
      ).success,
    ).toBe(false);
  });

  it("withholdings above the total are refused as invalid totals", async () => {
    await expect(createInvoice(ctx, createInput({ ivaWithheld: "500.00" }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("invoice number (CA3)", () => {
  it("is unique among the non-archived invoices", async () => {
    await expect(
      createInvoice(ctx, createInput({ invoiceNumber: " kai-0001 " })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("is free again once the holder is archived", async () => {
    await archiveInvoice(ctx, { id: OVERDUE });
    const created = await createInvoice(ctx, createInput({ invoiceNumber: "KAI-0003" }));
    expect(created.invoiceNumber).toBe("KAI-0003");
  });
});

describe("billing installments (CA1, CA5)", () => {
  it("lists the PENDIENTE installments of every project of the client", async () => {
    const rows = await listBillableInstallments(ctx, KAIROS);
    expect(rows.map((row) => row.installment.id)).toEqual(expect.arrayContaining([WEB_1, WEB_2]));
    expect(rows.every((row) => row.project.type === "PROJECT")).toBe(true);
  });

  it("billing installments creates their lines and marks them FACTURADA at save", async () => {
    const created = await createInvoice(
      ctx,
      createInput({
        clientId: KAIROS,
        invoiceNumber: "KAI-0100",
        currency: "USD",
        lines: [
          {
            description: "Anticipo",
            projectId: mockId("pry", "kairos_web"),
            installmentId: WEB_1,
            unitPrice: "4000.00",
            ivaRate: "16",
          },
          {
            description: "Hito de diseño",
            installmentId: WEB_2,
            unitPrice: "3000.00",
            ivaRate: "16",
          },
        ],
      }),
    );
    expect(created.lines[0]?.installment?.id).toBe(WEB_1);
    expect(created.lines[1]?.project?.id).toBe(mockId("pry", "kairos_web"));
    expect(created.totals.total).toBe("8120.00");
    expect(db.installments.find((row) => row.id === WEB_1)?.status).toBe("FACTURADA");
    expect(db.installments.find((row) => row.id === WEB_2)?.status).toBe("FACTURADA");
    expect(
      (await listBillableInstallments(ctx, KAIROS)).map((row) => row.installment.id),
    ).not.toContain(WEB_1);
  });

  it("refuses to bill more than the installment still has", async () => {
    await createInvoice(
      ctx,
      createInput({
        clientId: KAIROS,
        invoiceNumber: "KAI-0101",
        lines: [
          { description: "Anticipo", installmentId: WEB_1, unitPrice: "4000.00", ivaRate: "16" },
        ],
      }),
    );
    await expect(
      createInvoice(
        ctx,
        createInput({
          clientId: KAIROS,
          invoiceNumber: "KAI-0102",
          lines: [
            { description: "Otra vez", installmentId: WEB_1, unitPrice: "1.00", ivaRate: "16" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses two lines of the same installment in one invoice", async () => {
    await expect(
      createInvoice(
        ctx,
        createInput({
          clientId: KAIROS,
          invoiceNumber: "KAI-0104",
          lines: [
            { description: "Anticipo", installmentId: WEB_1, unitPrice: "1000.00", ivaRate: "16" },
            {
              description: "Anticipo bis",
              installmentId: WEB_1,
              unitPrice: "1000.00",
              ivaRate: "16",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("voiding the invoice releases its installments", async () => {
    const created = await createInvoice(
      ctx,
      createInput({
        clientId: KAIROS,
        invoiceNumber: "KAI-0103",
        lines: [
          { description: "Anticipo", installmentId: WEB_1, unitPrice: "4000.00", ivaRate: "16" },
        ],
      }),
    );
    await voidInvoice(ctx, { id: created.id, reason: "Duplicada" });
    expect(db.installments.find((row) => row.id === WEB_1)?.status).toBe("PENDIENTE");
  });

  it("refuses an installment of another client", async () => {
    await expect(
      createInvoice(
        ctx,
        createInput({
          invoiceNumber: "NEW-0200",
          lines: [
            { description: "Ajena", installmentId: WEB_1, unitPrice: "100.00", ivaRate: "16" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("PDF attachment (CA4)", () => {
  function addFile(overrides: Partial<(typeof db.files)[number]> = {}) {
    const file = {
      id: "fil_factura",
      originalName: "factura.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      status: "READY" as const,
      uploadedById: ctx.user.id,
      createdAt: FIXED_NOW.toISOString(),
      ...overrides,
    };
    db.files.push(file);
    return file;
  }

  it("attaches a ready PDF and shows it in the detail", async () => {
    addFile();
    const invoice = await attachInvoiceFile(ctx, { id: PARTIAL, fileId: "fil_factura" });
    expect(invoice.file?.id).toBe("fil_factura");
    expect((await getInvoice(ctx, PARTIAL)).file?.originalName).toBe("factura.pdf");
  });

  it("refuses a type outside PDF, PNG, JPG and WEBP", async () => {
    addFile({ id: "fil_txt", mimeType: "text/plain", originalName: "nota.txt" });
    await expect(attachInvoiceFile(ctx, { id: PARTIAL, fileId: "fil_txt" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("refuses a file above 10 MB", async () => {
    addFile({ id: "fil_big", sizeBytes: INVOICE_FILE_MAX_BYTES + 1 });
    await expect(attachInvoiceFile(ctx, { id: PARTIAL, fileId: "fil_big" })).rejects.toBeInstanceOf(
      ServiceError,
    );
  });

  it("refuses a file that is not ready yet", async () => {
    addFile({ id: "fil_pending", status: "PENDING" });
    await expect(
      attachInvoiceFile(ctx, { id: PARTIAL, fileId: "fil_pending" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("edit, drafts and archive", () => {
  it("refuses an edit that drops the receivable below what is already allocated", async () => {
    allocate(PARTIAL, "1000.00");
    const invoice = await getInvoice(ctx, PARTIAL);
    await expect(
      updateInvoice(
        ctx,
        updateInputOf(invoice, {
          lines: [{ description: "Menos", unitPrice: "500.00", ivaRate: "16" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
  });

  it("applies an edit that keeps the receivable above the allocated amount", async () => {
    const invoice = await getInvoice(ctx, PARTIAL);
    const updated = await updateInvoice(
      ctx,
      updateInputOf(invoice, {
        lines: [{ description: "Más", unitPrice: "2000.00", ivaRate: "16" }],
      }),
    );
    expect(updated.totals.total).toBe("2320.00");
  });

  it("HU-29 CA1: editing the total logs the diff total: [before, after]", async () => {
    const invoice = await getInvoice(ctx, PARTIAL);
    const before = invoice.totals.total;
    await updateInvoice(
      ctx,
      updateInputOf(invoice, {
        lines: [{ description: "Más", unitPrice: "2000.00", ivaRate: "16" }],
      }),
    );
    const entries = db.activity.filter(
      (entry) => entry.entityType === "INVOICE" && entry.entityId === PARTIAL,
    );
    expect(entries.at(-1)).toMatchObject({
      action: "UPDATE",
      changes: { total: [before, "2320.00"] },
    });
  });

  it("an edit that keeps the total logs no total diff", async () => {
    const invoice = await getInvoice(ctx, PARTIAL);
    await updateInvoice(ctx, updateInputOf(invoice, { controlNumber: "CTRL-9" }));
    const last = db.activity
      .filter((entry) => entry.entityType === "INVOICE" && entry.entityId === PARTIAL)
      .at(-1);
    expect(last?.action).toBe("UPDATE");
    expect(last?.changes?.total).toBeUndefined();
  });

  it("a draft becomes an issued invoice with issueDraft", async () => {
    const draft = await createInvoice(ctx, createInput({ invoiceNumber: "BOR-1", isDraft: true }));
    expect(draft.status).toBe("BORRADOR");
    const issued = await issueDraft(ctx, { id: draft.id });
    expect(issued.isDraft).toBe(false);
    expect(issued.status).toBe("EMITIDA");
    await expect(issueDraft(ctx, { id: draft.id })).rejects.toBeInstanceOf(ServiceError);
  });

  it("refuses to archive an invoice with active allocations", async () => {
    allocate(PAID, "100.00");
    await expect(archiveInvoice(ctx, { id: PAID })).rejects.toMatchObject({
      code: "INTEGRITY_LOCK",
    });
  });
});

describe("lists and overview (DT-25)", () => {
  it("hides archived invoices unless asked for, and searches by number", async () => {
    await archiveInvoice(ctx, { id: OVERDUE });
    const visible = await listInvoices(ctx, {});
    expect(visible.items.map((row) => row.id)).not.toContain(OVERDUE);

    const all = await listInvoices(ctx, { includeArchived: true });
    expect(all.items.map((row) => row.id)).toContain(OVERDUE);

    const found = await listInvoices(ctx, { q: "ZAF-0001" });
    expect(found.items.map((row) => row.id)).toEqual([MULTI]);
  });

  it("overview counts the overdue invoices and totals per currency", async () => {
    const overview = await getInvoicesOverview(ctx);
    expect(overview.overdueCount).toBe(1);
    expect(overview.billedVsCollected.periods).toHaveLength(6);
    expect(overview.totalsByCurrency.map((row) => row.currency)).toEqual(["USD"]);
  });

  it("an unknown invoice id is a NOT_FOUND, never a partial record", async () => {
    await expect(getInvoice(ctx, "inv_missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
