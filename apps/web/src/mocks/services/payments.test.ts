import { beforeEach, describe, expect, it } from "vitest";
import {
  createPaymentInputSchema,
  createPaymentInputSchemaFor,
  PAYMENT_MESSAGES,
  detectDuplicatePaymentInputSchema,
  paymentFiltersSchema,
} from "@/lib/validators/payments";
import { proposeAllocation } from "@/lib/finance";
import { ServiceError } from "../ctx";
import { makeInvoice, makeLine, ref } from "../finance-test-factories";
import { makeTestContext } from "../test-helpers";
import { deriveMockStore, type MockStore } from "../store";
import type { MockServiceContext } from "../ctx";
import { getAccount } from "./accounts";
import {
  allocatePayment,
  createPayment,
  deallocatePayment,
  detectDuplicatePayment,
  getClientCredit,
  getInvoiceForPayment,
  getPayment,
  getPaymentsOverview,
  listOpenInvoicesForClient,
  listPayments,
  PAYMENT_SERVICE_MESSAGES,
} from "./payments";

// Seed of the payments fixtures (T7): PAG-0001 (300 to the partial invoice), PAG-0002 (500 to the paid invoice),
// PAG-0003 (100 with IGTF 3, 97 unallocated). Invoices are built here with the test factories, not with the T6 seed.

let ctx: MockServiceContext;
let db: MockStore;

beforeEach(() => {
  ({ ctx, db } = makeTestContext("OWNER"));
});

/** Parses a payment input through the contract schema, so defaults and transforms apply as in the action. */
function paymentInput(overrides: Record<string, unknown> = {}) {
  return createPaymentInputSchema.parse({
    clientId: "cli_kairos",
    date: "2026-10-05",
    accountId: "acc_zelle",
    methodId: "pmt_zelle",
    currency: "USD",
    amount: "100.00",
    igtfAmount: "0.00",
    feeAmount: "0.00",
    usdRate: "1",
    reference: "REF-TEST-1",
    ...overrides,
  });
}

/** Filters of the list, parsed as the query layer does. */
const filters = (input: Record<string, unknown>) => paymentFiltersSchema.parse(input);

/** An open USD invoice of Kairos with the given receivable (exempt line, so the receivable is the line amount). */
function addInvoice(id: string, receivable: string, overrides: Record<string, unknown> = {}) {
  const invoice = makeInvoice({
    id,
    code: `FAC-T-${id}`,
    client: ref("cli_kairos", "CLIENT"),
    currency: "USD",
    usdRate: "1",
    dueDate: "2026-12-31",
    lines: [makeLine({ id: `${id}_l1`, unitPrice: receivable, ivaRate: null, installment: null })],
    ...overrides,
  } as never);
  db.invoices.push(invoice);
  deriveMockStore(db);
  return db.invoices.find((row) => row.id === id) as NonNullable<typeof invoice>;
}

async function expectValidation(promise: Promise<unknown>, field: string, message?: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ServiceError);
  const serviceError = error as ServiceError;
  expect(serviceError.code).toBe("VALIDATION");
  expect(Object.keys(serviceError.fieldErrors ?? {})).toContain(field);
  if (message) expect(serviceError.fieldErrors?.[field]).toContain(message);
}

// ───────────────────────────── HU-13 CA1: required fields ─────────────────────────────

describe("payment form contract (HU-13 CA1)", () => {
  it("requires the client, date, account, method, currency, amount and rate", () => {
    const parsed = createPaymentInputSchema.safeParse({});
    expect(parsed.success).toBe(false);
    const fields = new Set(parsed.error?.issues.map((issue) => String(issue.path[0] ?? "")) ?? []);
    for (const field of [
      "clientId",
      "date",
      "accountId",
      "methodId",
      "currency",
      "amount",
      "usdRate",
    ]) {
      expect(fields.has(field)).toBe(true);
    }
  });

  it("requires the reference when the method requires it, and not otherwise", () => {
    const without = paymentInput({ reference: undefined });
    expect(
      createPaymentInputSchemaFor({ requiresReference: true }).safeParse(without).success,
    ).toBe(false);
    expect(
      createPaymentInputSchemaFor({ requiresReference: false }).safeParse(without).success,
    ).toBe(true);
  });

  it("the service refuses a missing reference for a method that requires it", async () => {
    await expectValidation(
      createPayment(ctx, paymentInput({ reference: undefined, methodId: "pmt_zelle" })),
      "reference",
      PAYMENT_MESSAGES.referenceRequired,
    );
  });

  it("accepts a missing reference for a method that does not require one (cash)", async () => {
    const payment = await createPayment(
      ctx,
      paymentInput({ reference: undefined, methodId: "pmt_efectivo_usd" }),
    );
    expect(payment.reference).toBeNull();
  });

  it("refuses a payment in a currency other than the account's", async () => {
    await expectValidation(
      createPayment(ctx, paymentInput({ currency: "VES", usdRate: "36.5" })),
      "currency",
      PAYMENT_SERVICE_MESSAGES.currencyMismatch,
    );
  });
});

// ───────────────────────────── HU-13 CA2: IGTF and net credit ─────────────────────────────

describe("IGTF and fees (HU-13 CA2, §9.6)", () => {
  it("100 USD with IGTF 3 and fee 0: allocatable 97, net credited to the account 100", async () => {
    const before = (await getAccount(ctx, "acc_zelle")).balance;
    const payment = await createPayment(
      ctx,
      paymentInput({ igtfAmount: "3.00", feeAmount: "0.00" }),
    );

    expect(payment.allocatable).toBe("97.00");
    expect(payment.netCredited).toBe("100.00");
    expect(payment.unallocated).toBe("97.00");

    const after = (await getAccount(ctx, "acc_zelle")).balance;
    expect(Number(after) - Number(before)).toBeCloseTo(100, 2);
  });

  it("a fee reduces the net credited and not the allocatable amount", async () => {
    const payment = await createPayment(
      ctx,
      paymentInput({ igtfAmount: "0.00", feeAmount: "2.50" }),
    );
    expect(payment.netCredited).toBe("97.50");
    expect(payment.allocatable).toBe("100.00");
  });

  it("refuses an IGTF above the amount", () => {
    const parsed = createPaymentInputSchema.safeParse({
      ...paymentInput(),
      igtfAmount: "150.00",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["igtfAmount"],
        message: PAYMENT_MESSAGES.igtfExceedsAmount,
      }),
    );
  });
});

// ───────────────────────────── HU-13 CA3: allocations ─────────────────────────────

describe("allocations to open invoices (HU-13 CA3)", () => {
  it("the sum of the allocations cannot exceed the allocatable amount", async () => {
    addInvoice("inv_a", "1000.00");
    addInvoice("inv_b", "1000.00");
    await expectValidation(
      // The schema refuses this too; the allocations are set after parsing so the service rule is the one tested.
      createPayment(ctx, {
        ...paymentInput({ igtfAmount: "3.00" }),
        allocations: [
          { invoiceId: "inv_a", amountPaymentCurrency: "60.00", amountInvoiceCurrency: "60.00" },
          { invoiceId: "inv_b", amountPaymentCurrency: "40.00", amountInvoiceCurrency: "40.00" },
        ],
      }),
      "allocations",
      PAYMENT_MESSAGES.allocationsExceedAllocatable,
    );
  });

  it("each allocation cannot exceed the balance of its invoice", async () => {
    addInvoice("inv_small", "50.00");
    await expectValidation(
      createPayment(
        ctx,
        paymentInput({
          allocations: [
            {
              invoiceId: "inv_small",
              amountPaymentCurrency: "60.00",
              amountInvoiceCurrency: "60.00",
            },
          ],
        }),
      ),
      "allocations.0.amountInvoiceCurrency",
      PAYMENT_SERVICE_MESSAGES.allocationExceedsBalance,
    );
  });

  it("applies the allocations, updates the invoice balance and status, and keeps the rest as credit", async () => {
    const invoice = addInvoice("inv_partial", "1000.00");
    expect(invoice.totals.balance).toBe("1000.00");

    const payment = await createPayment(
      ctx,
      paymentInput({
        amount: "300.00",
        allocations: [
          {
            invoiceId: "inv_partial",
            amountPaymentCurrency: "250.00",
            amountInvoiceCurrency: "250.00",
          },
        ],
      }),
    );

    expect(payment.allocated).toBe("250.00");
    expect(payment.unallocated).toBe("50.00");
    expect(payment.allocations).toHaveLength(1);
    expect(payment.allocations[0]?.invoice.label).toBe("FAC-T-inv_partial");
    const updated = db.invoices.find((row) => row.id === "inv_partial");
    expect(updated?.totals.paidAmount).toBe("250.00");
    expect(updated?.totals.balance).toBe("750.00");
    expect(updated?.status).toBe("PARCIAL");
  });

  it("refuses an invoice of another client or one that is not open", async () => {
    addInvoice("inv_other", "100.00", { client: ref("cli_zafiro", "CLIENT") });
    addInvoice("inv_void", "100.00", { voidedAt: "2026-10-01T10:00:00.000Z" });
    await expectValidation(
      createPayment(
        ctx,
        paymentInput({
          allocations: [
            {
              invoiceId: "inv_other",
              amountPaymentCurrency: "10.00",
              amountInvoiceCurrency: "10.00",
            },
          ],
        }),
      ),
      "allocations.0.invoiceId",
      PAYMENT_SERVICE_MESSAGES.allocationInvoiceNotOpen,
    );
    await expectValidation(
      createPayment(
        ctx,
        paymentInput({
          allocations: [
            {
              invoiceId: "inv_void",
              amountPaymentCurrency: "10.00",
              amountInvoiceCurrency: "10.00",
            },
          ],
        }),
      ),
      "allocations.0.invoiceId",
      PAYMENT_SERVICE_MESSAGES.allocationInvoiceNotOpen,
    );
  });

  it("in the same currency the invoice amount must equal the payment amount", async () => {
    addInvoice("inv_same", "500.00");
    await expectValidation(
      createPayment(
        ctx,
        paymentInput({
          allocations: [
            {
              invoiceId: "inv_same",
              amountPaymentCurrency: "100.00",
              amountInvoiceCurrency: "90.00",
            },
          ],
        }),
      ),
      "allocations.0.amountInvoiceCurrency",
      PAYMENT_SERVICE_MESSAGES.allocationSameCurrency,
    );
  });

  it("allocatePayment applies a further amount with the same checks and deallocatePayment removes it", async () => {
    addInvoice("inv_later", "400.00");
    const payment = await createPayment(ctx, paymentInput({ amount: "300.00" }));
    const allocation = await allocatePayment(ctx, {
      paymentId: payment.id,
      invoiceId: "inv_later",
      amountPaymentCurrency: "120.00",
      amountInvoiceCurrency: "120.00",
    });
    expect(allocation.amountUsd).toBe("120.00");
    expect((await getPayment(ctx, payment.id)).unallocated).toBe("180.00");

    const after = await deallocatePayment(ctx, { allocationId: allocation.id });
    expect(after.allocated).toBe("0.00");
    expect(after.unallocated).toBe("300.00");
    expect(db.invoices.find((row) => row.id === "inv_later")?.totals.balance).toBe("400.00");
  });

  it("allocatePayment refuses a payment that is not confirmed", async () => {
    addInvoice("inv_pending", "100.00");
    const payment = await createPayment(ctx, paymentInput({ status: "PENDIENTE_VERIFICACION" }));
    await expectValidation(
      allocatePayment(ctx, {
        paymentId: payment.id,
        invoiceId: "inv_pending",
        amountPaymentCurrency: "10.00",
        amountInvoiceCurrency: "10.00",
      }),
      "paymentId",
      PAYMENT_SERVICE_MESSAGES.paymentNotConfirmed,
    );
  });

  it("lists only the open invoices of the client, with their balance", async () => {
    addInvoice("inv_open", "700.00");
    addInvoice("inv_closed", "100.00", { voidedAt: "2026-10-01T10:00:00.000Z" });
    const options = await listOpenInvoicesForClient(ctx, "cli_kairos");
    const ids = options.map((option) => option.id);
    expect(ids).toContain("inv_open");
    expect(ids).not.toContain("inv_closed");
    expect(options.find((option) => option.id === "inv_open")?.balance).toBe("700.00");
  });

  it("opens from an invoice (?invoiceId=) only while it takes a payment", async () => {
    addInvoice("inv_start", "300.00");
    addInvoice("inv_done", "300.00", { voidedAt: "2026-10-01T10:00:00.000Z" });
    expect((await getInvoiceForPayment(ctx, "inv_start"))?.client.id).toBe("cli_kairos");
    expect(await getInvoiceForPayment(ctx, "inv_done")).toBeNull();
    expect(await getInvoiceForPayment(ctx, "inv_missing")).toBeNull();
  });
});

// ───────────────────────────── HU-13 CA4: cross-currency proposal ─────────────────────────────

describe("cross-currency allocation (HU-13 CA4, §9.5)", () => {
  it("a VES payment against a USD invoice proposes the USD amount at the payment-day rate, and it stays editable", async () => {
    // 36 500 VES at 36.50 VES per USD is 1 000 USD (the proposal of lib/finance).
    const proposal = proposeAllocation({
      amountPaymentCurrency: "36500.00",
      paymentCurrency: "VES",
      paymentUsdRate: "36.50",
      invoiceCurrency: "USD",
      invoiceUsdRateOnPaymentDate: "1",
    });
    expect(proposal.amountUsd).toBe("1000.00");
    expect(proposal.amountInvoiceCurrency).toBe("1000.00");

    addInvoice("inv_usd", "1000.00");
    const payment = await createPayment(
      ctx,
      paymentInput({
        accountId: "acc_banco_ves",
        currency: "VES",
        amount: "36500.00",
        usdRate: "36.50",
        allocations: [
          // The user edited the proposal down to 990 USD: accepted, the remaining 10 stays as credit.
          {
            invoiceId: "inv_usd",
            amountPaymentCurrency: "36135.00",
            amountInvoiceCurrency: "990.00",
          },
        ],
      }),
    );
    // 36 135 VES at 36.50 is 990 USD; the rest of 36 500 VES (365 VES) stays as credit.
    expect(payment.allocations[0]?.amountUsd).toBe("990.00");
    expect(payment.allocations[0]?.amountInvoiceCurrency).toBe("990.00");
    expect(payment.unallocated).toBe("365.00");
  });
});

// ───────────────────────────── HU-13 CA5: saldo a favor ─────────────────────────────

describe("credit of the client (HU-13 CA5)", () => {
  it("the unallocated remainder of a confirmed payment is the client's credit", async () => {
    const credit = await getClientCredit(ctx, "cli_kairos");
    // Seed: PAG-0003 leaves 97 USD unallocated.
    expect(credit.payments.map((row) => row.code)).toContain("PAG-0003");
    expect(credit.totalUsd).toBe("97.00");
  });

  it("the credit goes down when the remainder is applied", async () => {
    addInvoice("inv_credit", "50.00");
    await allocatePayment(ctx, {
      paymentId: "pag_kairos_credit",
      invoiceId: "inv_credit",
      amountPaymentCurrency: "50.00",
      amountInvoiceCurrency: "50.00",
    });
    expect((await getClientCredit(ctx, "cli_kairos")).totalUsd).toBe("47.00");
  });

  it("refuses a client that does not exist", async () => {
    await expect(getClientCredit(ctx, "cli_missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ───────────────────────────── HU-13 CA6: duplicates ─────────────────────────────

describe("possible duplicates (HU-13 CA6)", () => {
  it("warns when another payment has the same reference, method and account", async () => {
    await createPayment(ctx, paymentInput({ reference: "OP-777" }));
    const warning = await detectDuplicatePayment(
      ctx,
      detectDuplicatePaymentInputSchema.parse({
        methodId: "pmt_zelle",
        accountId: "acc_zelle",
        reference: "op-777",
      }),
    );
    expect(warning.duplicate).toBe(true);
    expect(warning.matches).toHaveLength(1);
  });

  it("does not warn when the method or the account differs", async () => {
    await createPayment(ctx, paymentInput({ reference: "OP-888" }));
    expect(
      (
        await detectDuplicatePayment(
          ctx,
          detectDuplicatePaymentInputSchema.parse({
            methodId: "pmt_zinli",
            accountId: "acc_zelle",
            reference: "OP-888",
          }),
        )
      ).duplicate,
    ).toBe(false);
    expect(
      (
        await detectDuplicatePayment(
          ctx,
          detectDuplicatePaymentInputSchema.parse({
            methodId: "pmt_zelle",
            accountId: "acc_banco_ves",
            reference: "OP-888",
          }),
        )
      ).duplicate,
    ).toBe(false);
  });

  it("excludes the payment being edited", async () => {
    const payment = await createPayment(ctx, paymentInput({ reference: "OP-999" }));
    const warning = await detectDuplicatePayment(
      ctx,
      detectDuplicatePaymentInputSchema.parse({
        methodId: "pmt_zelle",
        accountId: "acc_zelle",
        reference: "OP-999",
        excludePaymentId: payment.id,
      }),
    );
    expect(warning.duplicate).toBe(false);
  });

  it("is a warning only: the payment is still saved", async () => {
    await createPayment(ctx, paymentInput({ reference: "OP-DUP" }));
    const second = await createPayment(ctx, paymentInput({ reference: "OP-DUP" }));
    expect(second.code).toMatch(/^PAG-\d{4}$/);
    expect(db.payments.filter((row) => row.reference === "OP-DUP")).toHaveLength(2);
  });
});

// ───────────────────────────── HU-14: receipt ─────────────────────────────

describe("receipt (HU-14)", () => {
  function addFile(
    id: string,
    name: string,
    mime: string,
    sizeBytes: number,
    status: "READY" | "PENDING" = "READY",
  ) {
    db.files.push({
      id,
      originalName: name,
      mimeType: mime,
      sizeBytes,
      status,
      uploadedById: ctx.user.id,
      createdAt: ctx.now.toISOString(),
    });
  }

  it.each([
    ["fil_pdf", "comprobante.pdf", "application/pdf"],
    ["fil_png", "captura.png", "image/png"],
    ["fil_jpg", "captura.jpg", "image/jpeg"],
    ["fil_webp", "captura.webp", "image/webp"],
  ])("accepts %s (%s) up to 10 MB", async (id, name, mime) => {
    addFile(id, name, mime, 1024 * 1024);
    const payment = await createPayment(ctx, paymentInput({ receiptFileId: id }));
    expect(payment.receiptFileId).toBe(id);
  });

  it("refuses a file above 10 MB", async () => {
    addFile("fil_big", "grande.pdf", "application/pdf", 10 * 1024 * 1024 + 1);
    await expectValidation(
      createPayment(ctx, paymentInput({ receiptFileId: "fil_big" })),
      "receiptFileId",
    );
  });

  it("refuses a type outside PDF, PNG, JPG and WEBP", async () => {
    addFile("fil_zip", "pagos.zip", "application/zip", 1024);
    await expectValidation(
      createPayment(ctx, paymentInput({ receiptFileId: "fil_zip" })),
      "receiptFileId",
    );
  });

  it("refuses a file that is not stored yet, or an unknown one", async () => {
    addFile("fil_pending", "espera.pdf", "application/pdf", 1024, "PENDING");
    await expect(
      createPayment(ctx, paymentInput({ receiptFileId: "fil_pending" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createPayment(ctx, paymentInput({ receiptFileId: "fil_unknown" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the receipt is returned with the payment detail, so it can be viewed there", async () => {
    addFile("fil_view", "vista.pdf", "application/pdf", 2048);
    const payment = await createPayment(ctx, paymentInput({ receiptFileId: "fil_view" }));
    expect((await getPayment(ctx, payment.id)).receipt?.originalName).toBe("vista.pdf");
  });
});

// ───────────────────────────── Reads ─────────────────────────────

describe("reads of the payments pages", () => {
  it("lists the seeded payments, filters them and searches by code or reference", async () => {
    const all = await listPayments(ctx, filters({}));
    expect(all.total).toBe(3);

    const withCredit = await listPayments(ctx, filters({ hasUnallocated: true }));
    expect(withCredit.items.map((row) => row.code)).toEqual(["PAG-0003"]);

    const byClient = await listPayments(ctx, filters({ clientId: ["cli_kairos"] }));
    expect(byClient.total).toBe(3);

    const searched = await listPayments(ctx, filters({ q: "ZL-MOCK-0002" }));
    expect(searched.items.map((row) => row.code)).toEqual(["PAG-0002"]);
  });

  it("the overview sums the confirmed payments by month, method and account, in USD", async () => {
    const overview = await getPaymentsOverview(ctx);
    expect(overview.collectedByMonth).toHaveLength(12);
    const september = overview.collectedByMonth.find((point) => point.period === "2026-09");
    expect(september?.value).toBe("800.00");
    expect(overview.byMethod).toEqual([expect.objectContaining({ key: "ZELLE", value: "900.00" })]);
    expect(overview.unallocatedCount).toBe(1);
    expect(overview.unallocatedTotalUsd).toBe("97.00");
    expect(overview.pendingVerificationCount).toBe(0);
  });

  it("a payment detail carries the amounts and the allocations of its invoices", async () => {
    const payment = await getPayment(ctx, "pag_kairos_partial");
    expect(payment.code).toBe("PAG-0001");
    expect(payment.allocations).toHaveLength(1);
    expect(payment.allocated).toBe("300.00");
  });

  it("an unknown payment id is a plain not-found (C14)", async () => {
    await expect(getPayment(ctx, "pag_missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the record of a payment", () => {
  it("writes an activity entry with the payment code", async () => {
    const payment = await createPayment(ctx, paymentInput({ reference: "OP-LOG" }));
    const entry = db.activity.find((row) => row.entityId === payment.id);
    expect(entry).toMatchObject({
      action: "CREATE",
      entityType: "PAYMENT",
      entityLabel: payment.code,
    });
  });
});
