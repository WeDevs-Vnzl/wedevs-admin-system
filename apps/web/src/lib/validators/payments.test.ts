import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/payments.json";
import es from "@/i18n/messages/es/payments.json";
import { VALIDATION_MESSAGES } from "./common";
import { CATALOG_MESSAGES } from "./catalogs";
import {
  DUPLICATE_PAYMENT_WARNING,
  PAYMENT_MESSAGES,
  createPaymentInputSchema,
  createPaymentInputSchemaFor,
  duplicatePaymentWarningDtoSchema,
  paymentFiltersSchema,
  searchPaymentsInputSchema,
  setPaymentStatusInputSchema,
  updatePaymentInputSchema,
  PAYMENT_SORT_FIELDS,
} from "./payments";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

function hasKey(catalog: unknown, path: string[]): boolean {
  let node: unknown = catalog;
  for (const part of path) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" && node.length > 0;
}

const payment = {
  clientId: "c1",
  date: "2026-10-09",
  accountId: "acc1",
  methodId: "m1",
  currency: "VES",
  amount: "18270.00",
  usdRate: "36.54000000",
  reference: "0012345",
};

const ref = (id: string, type: "CLIENT" | "ACCOUNT" | "INVOICE" | "PAYMENT") => ({
  id,
  label: id,
  type,
});

describe("payment message keys", () => {
  it("exist in the payments namespace for es and en", () => {
    const keys = [...Object.values(PAYMENT_MESSAGES), DUPLICATE_PAYMENT_WARNING.message];
    for (const key of keys) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

describe("createPayment input", () => {
  it("accepts a payment and defaults IGTF, fee, status and allocations", () => {
    const parsed = createPaymentInputSchema.parse(payment);
    expect(parsed).toMatchObject({
      igtfAmount: "0",
      feeAmount: "0",
      status: "CONFIRMADO",
      allocations: [],
    });
  });

  it("money fields reject numbers and more than 2 decimals", () => {
    expect(createPaymentInputSchema.safeParse({ ...payment, amount: 100 }).success).toBe(false);
    expect(
      messages(createPaymentInputSchema.safeParse({ ...payment, amount: "10.555" })),
    ).toContain(VALIDATION_MESSAGES.moneyTooManyDecimals);
    expect(createPaymentInputSchema.safeParse({ ...payment, amount: "0" }).success).toBe(false);
    expect(createPaymentInputSchema.safeParse({ ...payment, igtfAmount: "0.001" }).success).toBe(
      false,
    );
    expect(createPaymentInputSchema.safeParse({ ...payment, feeAmount: -1 }).success).toBe(false);
  });

  it("rates must be greater than zero", () => {
    for (const usdRate of ["0", "0.00000000", "-3", "1.123456789"]) {
      expect(createPaymentInputSchema.safeParse({ ...payment, usdRate }).success, usdRate).toBe(
        false,
      );
    }
    expect(createPaymentInputSchema.safeParse({ ...payment, usdRate: 36.54 }).success).toBe(false);
  });

  it("USD payments must use rate 1", () => {
    const usd = { ...payment, currency: "USD", amount: "500.00" };
    expect(createPaymentInputSchema.safeParse({ ...usd, usdRate: "1" }).success).toBe(true);
    expect(messages(createPaymentInputSchema.safeParse({ ...usd, usdRate: "2" }))).toContain(
      CATALOG_MESSAGES.usdRateMustBeOne,
    );
  });

  it("requires the reference only when the method requires it", () => {
    const { reference, ...withoutReference } = payment;
    void reference;
    expect(createPaymentInputSchema.safeParse(withoutReference).success).toBe(true);
    const strict = createPaymentInputSchemaFor({ requiresReference: true });
    expect(messages(strict.safeParse(withoutReference))).toContain(
      PAYMENT_MESSAGES.referenceRequired,
    );
    expect(messages(strict.safeParse({ ...payment, reference: "   " }))).toContain(
      PAYMENT_MESSAGES.referenceRequired,
    );
    expect(strict.safeParse(payment).success).toBe(true);
  });

  it("IGTF and fee cannot exceed the amount", () => {
    expect(
      messages(createPaymentInputSchema.safeParse({ ...payment, igtfAmount: "18270.01" })),
    ).toContain(PAYMENT_MESSAGES.igtfExceedsAmount);
    expect(
      messages(createPaymentInputSchema.safeParse({ ...payment, feeAmount: "18270.01" })),
    ).toContain(PAYMENT_MESSAGES.feeExceedsAmount);
    expect(
      createPaymentInputSchema.safeParse({ ...payment, igtfAmount: "548.10", feeAmount: "10.00" })
        .success,
    ).toBe(true);
  });

  it("only creates pending or confirmed payments", () => {
    expect(
      createPaymentInputSchema.safeParse({ ...payment, status: "PENDIENTE_VERIFICACION" }).success,
    ).toBe(true);
    expect(createPaymentInputSchema.safeParse({ ...payment, status: "ANULADO" }).success).toBe(
      false,
    );
  });

  it("allocations may not exceed amount − IGTF, nor repeat an invoice", () => {
    const allocations = [
      { invoiceId: "inv1", amountPaymentCurrency: "9000.00", amountInvoiceCurrency: "246.30" },
      { invoiceId: "inv2", amountPaymentCurrency: "8721.90", amountInvoiceCurrency: "238.70" },
    ];
    // allocatable = 18270.00 − 548.10 = 17721.90 → exactly the sum
    expect(
      createPaymentInputSchema.safeParse({ ...payment, igtfAmount: "548.10", allocations }).success,
    ).toBe(true);
    expect(
      messages(
        createPaymentInputSchema.safeParse({ ...payment, igtfAmount: "548.11", allocations }),
      ),
    ).toContain(PAYMENT_MESSAGES.allocationsExceedAllocatable);
    expect(
      messages(
        createPaymentInputSchema.safeParse({
          ...payment,
          allocations: [allocations[0], { ...allocations[0] }],
        }),
      ),
    ).toContain(PAYMENT_MESSAGES.duplicateInvoiceAllocation);
  });

  it("does not throw when an allocation amount is malformed", () => {
    expect(() =>
      createPaymentInputSchema.safeParse({
        ...payment,
        allocations: [
          { invoiceId: "i", amountPaymentCurrency: "x", amountInvoiceCurrency: "1.00" },
        ],
      }),
    ).not.toThrow();
  });

  it("update takes the id and no allocations", () => {
    const update = updatePaymentInputSchema.parse({ ...payment, id: "pay1" });
    expect(Object.keys(update)).not.toContain("allocations");
    expect(updatePaymentInputSchema.safeParse(payment).success).toBe(false);
  });
});

describe("allocations and status", () => {
  it("setPaymentStatus accepts any status and an optional reason", () => {
    expect(
      setPaymentStatusInputSchema.safeParse({ id: "pay1", status: "ANULADO", reason: "x" }).success,
    ).toBe(true);
    expect(
      setPaymentStatusInputSchema.safeParse({ id: "pay1", status: "CONFIRMADO" }).success,
    ).toBe(true);
    expect(setPaymentStatusInputSchema.safeParse({ id: "pay1", status: "PAGADO" }).success).toBe(
      false,
    );
  });
});

describe("duplicate detection", () => {
  it("warning DTO lists the existing payments", () => {
    const dto = {
      duplicate: true,
      matches: [
        {
          payment: ref("pay9", "PAYMENT"),
          date: "2026-10-01",
          amount: "100.00",
          currency: "USD",
          status: "CONFIRMADO",
        },
      ],
    };
    expect(duplicatePaymentWarningDtoSchema.safeParse(dto).success).toBe(true);
    expect(
      duplicatePaymentWarningDtoSchema.safeParse({ duplicate: false, matches: [] }).success,
    ).toBe(true);
    expect(DUPLICATE_PAYMENT_WARNING.code).toBe("DUPLICATE_PAYMENT");
  });
});

describe("payment filters", () => {
  it("parses the status, the unallocated flag and the multi-value facets", () => {
    const filters = paymentFiltersSchema.parse({
      status: "PENDIENTE_VERIFICACION",
      hasUnallocated: "true",
    });
    expect(filters.status).toEqual(["PENDIENTE_VERIFICACION"]);
    expect(filters.hasUnallocated).toBe(true);
    const multi = paymentFiltersSchema.parse({
      clientId: ["c1", "c2"],
      accountId: "a1",
      methodId: ["m1", "m2"],
    });
    expect(multi).toMatchObject({
      clientId: ["c1", "c2"],
      accountId: ["a1"],
      methodId: ["m1", "m2"],
    });
  });
});

describe("sort whitelist (m2)", () => {
  it("accepts the listed fields and rejects any other", () => {
    expect(paymentFiltersSchema.safeParse({}).success).toBe(true);
    for (const field of PAYMENT_SORT_FIELDS) {
      expect(paymentFiltersSchema.safeParse({ sort: `${field}:asc` }).success, field).toBe(true);
    }
    const result = paymentFiltersSchema.safeParse({ sort: "receiptFileId:asc" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      message: VALIDATION_MESSAGES.invalidSort,
      path: ["sort"],
    });
  });
});

describe("searchPaymentsInputSchema (typeahead input)", () => {
  it("defaults to an empty search and trims the text", () => {
    expect(searchPaymentsInputSchema.parse({})).toEqual({ q: "" });
    expect(searchPaymentsInputSchema.parse({ q: "  PAG-0001 " })).toEqual({ q: "PAG-0001" });
  });

  it("refuses a search longer than 200 characters", () => {
    expect(searchPaymentsInputSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("BE message keys the screens render (payments.json)", () => {
  const keys = [
    ["errors", "voided"],
    ["errors", "invalidTransition"],
    ["errors", "clientLocked"],
    ["errors", "allocatableBelowAllocated"],
    ["validation", "receiptUnavailable"],
    ["validation", "providerInvoiceClientMismatch"],
    ["validation", "allocationAmountRequired"],
  ];

  it.each(keys)("has payments.%s.%s in both locales", (group, key) => {
    expect(hasKey(es, [group!, key!])).toBe(true);
    expect(hasKey(en, [group!, key!])).toBe(true);
  });
});
