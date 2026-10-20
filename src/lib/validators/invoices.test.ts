import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/invoices.json";
import es from "@/i18n/messages/es/invoices.json";
import { VALIDATION_MESSAGES } from "./common";
import { CATALOG_MESSAGES } from "./catalogs";
import {
  INVOICE_MESSAGES,
  INVOICE_SORT_FIELDS,
  createInvoiceInputSchema,
  createInvoiceInputSchemaFor,
  invoiceDetailDtoSchema,
  invoiceFiltersSchema,
  invoiceInstallmentsWizardInputSchema,
  invoiceLineDtoSchema,
  invoiceLineInputSchema,
  invoiceListRowSchema,
  invoiceTaxLineDtoSchema,
  invoiceTotalsDtoSchema,
  ivaAdjustmentSchema,
  openInvoiceRowSchema,
  quantitySchema,
  updateInvoiceInputSchema,
  voidInvoiceInputSchema,
} from "./invoices";

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

const line = {
  description: "Desarrollo MVP",
  quantity: "1",
  unitPrice: "1000.00",
  discount: "0",
  ivaRate: "16",
};

const invoice = {
  clientId: "c1",
  invoiceNumber: "00001234",
  issueDate: "2026-10-09",
  dueDate: "2026-10-24",
  currency: "USD",
  usdRate: "1",
  lines: [line],
};

describe("invoice message keys", () => {
  it("exist in the invoices namespace for es and en", () => {
    for (const key of Object.values(INVOICE_MESSAGES)) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

describe("invoice lines (DT-44)", () => {
  it("accepts a line and defaults quantity and discount", () => {
    const parsed = invoiceLineInputSchema.parse({
      description: "Hosting",
      unitPrice: "20.00",
      ivaRate: null,
    });
    expect(parsed).toMatchObject({ quantity: "1", discount: "0", ivaRate: null });
  });

  it("requires the VAT rate key: null means exempt, 0 means taxable at 0 %", () => {
    expect(invoiceLineInputSchema.safeParse({ ...line, ivaRate: undefined }).success).toBe(false);
    expect(invoiceLineInputSchema.safeParse({ ...line, ivaRate: null }).success).toBe(true);
    expect(invoiceLineInputSchema.safeParse({ ...line, ivaRate: "0" }).success).toBe(true);
  });

  it("rejects a line discount above the line amount; accepts it equal", () => {
    expect(messages(invoiceLineInputSchema.safeParse({ ...line, discount: "1000.01" }))).toContain(
      INVOICE_MESSAGES.discountExceedsAmount,
    );
    expect(invoiceLineInputSchema.safeParse({ ...line, discount: "1000.00" }).success).toBe(true);
    // amount = round(2.5 × 10.01, 2) = 25.03 (half up)
    const fractional = { ...line, quantity: "2.5", unitPrice: "10.01" };
    expect(invoiceLineInputSchema.safeParse({ ...fractional, discount: "25.03" }).success).toBe(
      true,
    );
    expect(invoiceLineInputSchema.safeParse({ ...fractional, discount: "25.04" }).success).toBe(
      false,
    );
  });

  it("money fields reject numbers and more than 2 decimals", () => {
    expect(invoiceLineInputSchema.safeParse({ ...line, unitPrice: 1000 }).success).toBe(false);
    expect(messages(invoiceLineInputSchema.safeParse({ ...line, unitPrice: "10.123" }))).toContain(
      VALIDATION_MESSAGES.moneyTooManyDecimals,
    );
    expect(invoiceLineInputSchema.safeParse({ ...line, discount: -1 }).success).toBe(false);
    expect(messages(invoiceLineInputSchema.safeParse({ ...line, discount: "-1.00" }))).toContain(
      VALIDATION_MESSAGES.moneyMustBeNonNegative,
    );
    expect(invoiceLineInputSchema.safeParse({ ...line, unitPrice: "0" }).success).toBe(false);
  });

  it("does not throw on malformed operands while checking the discount", () => {
    expect(() =>
      invoiceLineInputSchema.safeParse({ ...line, quantity: "abc", unitPrice: "x", discount: "y" }),
    ).not.toThrow();
  });

  it("quantity is positive with at most 2 decimals", () => {
    expect(quantitySchema.safeParse("3").success).toBe(true);
    expect(quantitySchema.safeParse("0.50").success).toBe(true);
    expect(quantitySchema.safeParse("0").success).toBe(false);
    expect(quantitySchema.safeParse("1.001").success).toBe(false);
    expect(quantitySchema.safeParse("12345678901").success).toBe(false);
    expect(quantitySchema.safeParse(1).success).toBe(false);
  });
});

describe("createInvoice input", () => {
  it("accepts a valid invoice and defaults withholdings, draft flag and adjustments", () => {
    const parsed = createInvoiceInputSchema.parse(invoice);
    expect(parsed).toMatchObject({
      ivaWithheld: "0",
      islrWithheld: "0",
      otherWithheld: "0",
      isDraft: false,
      taxAdjustments: [],
    });
  });

  it("has no header VAT rate or header totals (they are derived from the lines)", () => {
    const keys = Object.keys(createInvoiceInputSchema.shape);
    for (const forbidden of [
      "ivaRate",
      "subtotal",
      "discount",
      "taxBase",
      "total",
      "exemptAmount",
    ]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    expect(
      Object.keys(createInvoiceInputSchema.parse({ ...invoice, ivaRate: "16" })),
    ).not.toContain("ivaRate");
  });

  it("needs at least one line", () => {
    expect(createInvoiceInputSchema.safeParse({ ...invoice, lines: [] }).success).toBe(false);
  });

  it("accepts mixed rates (16, 8, 0, exempt) from the default allowed list", () => {
    const lines = ["16", "8", "0", null].map((ivaRate) => ({ ...line, ivaRate }));
    expect(createInvoiceInputSchema.safeParse({ ...invoice, lines }).success).toBe(true);
  });

  it("rejects a VAT rate outside the allowed list and points at the line", () => {
    const result = createInvoiceInputSchema.safeParse({
      ...invoice,
      lines: [line, { ...line, ivaRate: "12" }],
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find(
      (i) => i.message === INVOICE_MESSAGES.ivaRateNotAllowed,
    );
    expect(issue?.path).toEqual(["lines", 1, "ivaRate"]);
  });

  it("uses the allowed list from settings", () => {
    const custom = createInvoiceInputSchemaFor(["16", "0"]);
    expect(custom.safeParse(invoice).success).toBe(true);
    const eight = { ...invoice, lines: [{ ...line, ivaRate: "8" }] };
    expect(custom.safeParse(eight).success).toBe(false);
    expect(createInvoiceInputSchemaFor(["8"]).safeParse(eight).success).toBe(true);
    // numeric comparison: "16.00" is the allowed 16
    expect(custom.safeParse({ ...invoice, lines: [{ ...line, ivaRate: "16.00" }] }).success).toBe(
      true,
    );
  });

  it("allows a ±0.01 IVA adjustment per rate and rejects anything beyond", () => {
    for (const adjustment of ["0.01", "-0.01", "0.00", "0"]) {
      const result = createInvoiceInputSchema.safeParse({
        ...invoice,
        taxAdjustments: [{ ivaRate: "16", adjustment }],
      });
      expect(result.success, adjustment).toBe(true);
    }
    for (const adjustment of ["0.02", "-0.02", "1.00", "0.011"]) {
      const result = createInvoiceInputSchema.safeParse({
        ...invoice,
        taxAdjustments: [{ ivaRate: "16", adjustment }],
      });
      expect(result.success, adjustment).toBe(false);
    }
    expect(
      messages(
        createInvoiceInputSchema.safeParse({
          ...invoice,
          taxAdjustments: [{ ivaRate: "16", adjustment: "0.02" }],
        }),
      ),
    ).toContain(INVOICE_MESSAGES.adjustmentOutOfRange);
    expect(
      createInvoiceInputSchema.safeParse({
        ...invoice,
        taxAdjustments: [{ ivaRate: "16", adjustment: 0.01 }],
      }).success,
    ).toBe(false);
  });

  it("an adjustment must target a rate used by the lines, once", () => {
    expect(
      messages(
        createInvoiceInputSchema.safeParse({
          ...invoice,
          taxAdjustments: [{ ivaRate: "8", adjustment: "0.01" }],
        }),
      ),
    ).toContain(INVOICE_MESSAGES.adjustmentRateNotInLines);
    expect(
      messages(
        createInvoiceInputSchema.safeParse({
          ...invoice,
          taxAdjustments: [
            { ivaRate: "16", adjustment: "0.01" },
            { ivaRate: "16.00", adjustment: "-0.01" },
          ],
        }),
      ),
    ).toContain(INVOICE_MESSAGES.duplicateAdjustmentRate);
    // exempt lines (null) do not carry tax, so no adjustment applies to them
    expect(
      createInvoiceInputSchema.safeParse({
        ...invoice,
        lines: [{ ...line, ivaRate: null }],
        taxAdjustments: [{ ivaRate: "16", adjustment: "0.01" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a due date before the issue date", () => {
    expect(
      messages(createInvoiceInputSchema.safeParse({ ...invoice, dueDate: "2026-10-08" })),
    ).toContain(INVOICE_MESSAGES.dueBeforeIssue);
    expect(createInvoiceInputSchema.safeParse({ ...invoice, dueDate: "2026-10-09" }).success).toBe(
      true,
    );
  });

  it("validates currency and rate", () => {
    expect(createInvoiceInputSchema.safeParse({ ...invoice, currency: "usd" }).success).toBe(false);
    expect(createInvoiceInputSchema.safeParse({ ...invoice, usdRate: 1 }).success).toBe(false);
    expect(createInvoiceInputSchema.safeParse({ ...invoice, usdRate: "0" }).success).toBe(false);
    expect(messages(createInvoiceInputSchema.safeParse({ ...invoice, usdRate: "36.5" }))).toContain(
      CATALOG_MESSAGES.usdRateMustBeOne,
    );
    const ves = { ...invoice, currency: "VES", usdRate: "36.54120000", bcvRate: "36.5" };
    expect(createInvoiceInputSchema.safeParse(ves).success).toBe(true);
    expect(createInvoiceInputSchema.safeParse({ ...ves, bcvRate: "1.123456789" }).success).toBe(
      false,
    );
  });

  it("withholdings are non-negative decimals; other withholdings need a description", () => {
    const withholdings = { ivaWithheld: "120.00", islrWithheld: "10.50" };
    expect(createInvoiceInputSchema.safeParse({ ...invoice, ...withholdings }).success).toBe(true);
    expect(createInvoiceInputSchema.safeParse({ ...invoice, ivaWithheld: "-1.00" }).success).toBe(
      false,
    );
    expect(createInvoiceInputSchema.safeParse({ ...invoice, islrWithheld: 5 }).success).toBe(false);
    expect(createInvoiceInputSchema.safeParse({ ...invoice, otherWithheld: "1.234" }).success).toBe(
      false,
    );
    expect(
      messages(createInvoiceInputSchema.safeParse({ ...invoice, otherWithheld: "5.00" })),
    ).toContain(INVOICE_MESSAGES.otherWithheldNoteRequired);
    expect(
      createInvoiceInputSchema.safeParse({
        ...invoice,
        otherWithheld: "5.00",
        otherWithheldNote: "Municipal",
      }).success,
    ).toBe(true);
  });

  it("references a file by id and supports drafts", () => {
    const parsed = createInvoiceInputSchema.parse({ ...invoice, fileId: "file-1", isDraft: true });
    expect(parsed).toMatchObject({ fileId: "file-1", isDraft: true });
    expect(createInvoiceInputSchema.parse({ ...invoice, fileId: null }).fileId).toBeUndefined();
  });

  it("update takes the id and keeps every rule", () => {
    expect(updateInvoiceInputSchema.safeParse({ ...invoice, id: "inv1" }).success).toBe(true);
    expect(updateInvoiceInputSchema.safeParse(invoice).success).toBe(false);
    expect(
      updateInvoiceInputSchema.safeParse({
        ...invoice,
        id: "inv1",
        lines: [{ ...line, ivaRate: "12" }],
      }).success,
    ).toBe(false);
  });
});

describe("voidInvoice input", () => {
  it("requires a reason", () => {
    expect(voidInvoiceInputSchema.safeParse({ id: "inv1", reason: "Duplicada" }).success).toBe(
      true,
    );
    for (const reason of [undefined, "", "   "]) {
      const result = voidInvoiceInputSchema.safeParse({ id: "inv1", reason });
      expect(result.success, String(reason)).toBe(false);
    }
    expect(messages(voidInvoiceInputSchema.safeParse({ id: "inv1", reason: "" }))).toContain(
      VALIDATION_MESSAGES.required,
    );
  });
});

describe("invoice installments wizard", () => {
  it("accepts selected installments, partial amounts and per-item VAT", () => {
    const parsed = invoiceInstallmentsWizardInputSchema.safeParse({
      clientId: "c1",
      items: [
        { installmentId: "i1" },
        { installmentId: "i2", amount: "500.00", ivaRate: null },
        { installmentId: "i3", ivaRate: "8" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty selection, repeats and bad amounts", () => {
    expect(
      invoiceInstallmentsWizardInputSchema.safeParse({ clientId: "c1", items: [] }).success,
    ).toBe(false);
    expect(
      messages(
        invoiceInstallmentsWizardInputSchema.safeParse({
          clientId: "c1",
          items: [{ installmentId: "i1" }, { installmentId: "i1" }],
        }),
      ),
    ).toContain(INVOICE_MESSAGES.duplicateInstallment);
    expect(
      invoiceInstallmentsWizardInputSchema.safeParse({
        clientId: "c1",
        items: [{ installmentId: "i1", amount: "0" }],
      }).success,
    ).toBe(false);
  });
});

describe("invoice DTOs", () => {
  const ref = (id: string, type: "CLIENT" | "PROJECT" | "PAYMENT" | "INSTALLMENT" | "INVOICE") => ({
    id,
    label: id,
    type,
  });
  const lineDto = {
    id: "l1",
    order: 0,
    description: "Desarrollo",
    project: ref("p1", "PROJECT"),
    installment: null,
    quantity: "1.00",
    unitPrice: "1000.00",
    amount: "1000.00",
    discount: "0.00",
    netAmount: "1000.00",
    ivaRate: "16",
  };
  const totals = {
    subtotal: "1200.00",
    discount: "0.00",
    exemptAmount: "200.00",
    taxBase: "1000.00",
    ivaAmount: "160.00",
    total: "1360.00",
    ivaWithheld: "120.00",
    islrWithheld: "0.00",
    otherWithheld: "0.00",
    otherWithheldNote: null,
    receivable: "1240.00",
    totalUsd: "1360.00",
    receivableUsd: "1240.00",
    paidAmount: "500.00",
    balance: "740.00",
    balanceUsd: "740.00",
  };

  it("line DTO carries computed amount/netAmount and a nullable rate", () => {
    expect(invoiceLineDtoSchema.safeParse(lineDto).success).toBe(true);
    expect(invoiceLineDtoSchema.safeParse({ ...lineDto, ivaRate: null }).success).toBe(true);
    expect(invoiceLineDtoSchema.safeParse({ ...lineDto, amount: 1000 }).success).toBe(false);
  });

  it("tax line DTO has rate, base and IVA", () => {
    const tax = { ivaRate: "16", taxBase: "1000.00", ivaAmount: "160.01", adjustment: "0.01" };
    expect(invoiceTaxLineDtoSchema.safeParse(tax).success).toBe(true);
    expect(invoiceTaxLineDtoSchema.safeParse({ ...tax, ivaRate: undefined }).success).toBe(false);
  });

  it("totals DTO has every derived header figure and the USD snapshots", () => {
    expect(invoiceTotalsDtoSchema.safeParse(totals).success).toBe(true);
    for (const key of Object.keys(totals)) {
      if (key === "otherWithheldNote") continue;
      expect(invoiceTotalsDtoSchema.safeParse({ ...totals, [key]: undefined }).success, key).toBe(
        false,
      );
    }
    expect(invoiceTotalsDtoSchema.safeParse({ ...totals, total: 1360 }).success).toBe(false);
  });

  it("list row exposes balance, USD values, days overdue and the partial-payment flag", () => {
    const row = {
      id: "inv1",
      code: "FAC-0001",
      invoiceNumber: "00001234",
      client: ref("c1", "CLIENT"),
      projects: [ref("p1", "PROJECT")],
      issueDate: "2026-09-01",
      dueDate: "2026-09-16",
      currency: "USD",
      total: "1360.00",
      balance: "740.00",
      totalUsd: "1360.00",
      balanceUsd: "740.00",
      status: "VENCIDA",
      daysOverdue: 23,
      hasPartialPayment: true,
    };
    expect(invoiceListRowSchema.safeParse(row).success).toBe(true);
    expect(invoiceListRowSchema.safeParse({ ...row, daysOverdue: -1 }).success).toBe(false);
    expect(invoiceListRowSchema.safeParse({ ...row, status: "ATRASADA" }).success).toBe(false);
  });

  it("detail DTO aggregates lines, tax lines, totals and allocations", () => {
    const detail = {
      id: "inv1",
      code: "FAC-0001",
      client: ref("c1", "CLIENT"),
      invoiceNumber: "00001234",
      controlNumber: null,
      issueDate: "2026-09-01",
      dueDate: "2026-09-16",
      currency: "USD",
      usdRate: "1",
      bcvRate: null,
      isDraft: false,
      status: "PARCIAL",
      voidedAt: null,
      voidReason: null,
      archivedAt: null,
      fileId: null,
      file: null,
      lines: [lineDto],
      taxLines: [{ ivaRate: "16", taxBase: "1000.00", ivaAmount: "160.00", adjustment: "0.00" }],
      totals,
      allocations: [
        {
          id: "a1",
          payment: ref("pay1", "PAYMENT"),
          paymentDate: "2026-09-10",
          paymentCurrency: "VES",
          amountPaymentCurrency: "18270.00",
          amountInvoiceCurrency: "500.00",
          amountUsd: "500.00",
        },
      ],
      daysOverdue: 0,
      hasPartialPayment: true,
      createdAt: "2026-09-01T10:00:00Z",
      updatedAt: "2026-09-10T10:00:00Z",
      createdById: "u1",
    };
    expect(invoiceDetailDtoSchema.safeParse(detail).success).toBe(true);
  });

  it("open invoice row for the payment form", () => {
    const row = {
      id: "inv1",
      code: "FAC-0001",
      invoiceNumber: "1",
      issueDate: "2026-09-01",
      dueDate: "2026-09-16",
      currency: "USD",
      usdRate: "1",
      receivable: "1240.00",
      balance: "740.00",
      status: "EMITIDA",
    };
    expect(openInvoiceRowSchema.safeParse(row).success).toBe(true);
  });
});

describe("invoice filters", () => {
  it("extends the list query with typed facets", () => {
    const parsed = invoiceFiltersSchema.parse({
      status: "VENCIDA",
      currency: ["USD", "VES"],
      clientId: "c1",
    });
    expect(parsed.status).toEqual(["VENCIDA"]);
    expect(parsed.currency).toEqual(["USD", "VES"]);
    expect(parsed.pageSize).toBe(25);
    expect(invoiceFiltersSchema.safeParse({ status: "ATRASADA" }).success).toBe(false);
  });

  it("accepts one or many client, project and tag ids (kit facets are multi)", () => {
    const one = invoiceFiltersSchema.parse({ clientId: "c1" });
    expect(one.clientId).toEqual(["c1"]);
    const many = invoiceFiltersSchema.parse({
      clientId: ["c1", "c2"],
      projectId: ["p1", "p2"],
      tagId: ["t1", "t2"],
    });
    expect(many).toMatchObject({
      clientId: ["c1", "c2"],
      projectId: ["p1", "p2"],
      tagId: ["t1", "t2"],
    });
    expect(invoiceFiltersSchema.safeParse({ clientId: ["c1", "bad id"] }).success).toBe(false);
  });
});

describe("IVA adjustment on a 0 % rate (m3)", () => {
  it("rejects any adjustment on a rate whose IVA is 0", () => {
    for (const ivaRate of ["0", "0.00"]) {
      for (const adjustment of ["0.01", "-0.01", "0"]) {
        const result = ivaAdjustmentSchema.safeParse({ ivaRate, adjustment });
        expect(result.success, `${ivaRate}/${adjustment}`).toBe(false);
        expect(result.error?.issues[0]).toMatchObject({
          path: ["ivaRate"],
          message: INVOICE_MESSAGES.adjustmentRateNotInLines,
        });
      }
    }
  });

  it("still accepts ±0.01 on a taxed rate", () => {
    for (const ivaRate of ["16", "8", "0.5"]) {
      expect(ivaAdjustmentSchema.safeParse({ ivaRate, adjustment: "-0.01" }).success, ivaRate).toBe(
        true,
      );
    }
  });

  it("an invoice cannot carry an adjustment on a 0 % line", () => {
    const result = createInvoiceInputSchema.safeParse({
      ...invoice,
      lines: [{ ...line, ivaRate: "0" }],
      taxAdjustments: [{ ivaRate: "0", adjustment: "-0.01" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain("taxAdjustments.0.ivaRate");
  });
});

describe("sort whitelist (m2)", () => {
  it("accepts the listed fields in both directions and no sort", () => {
    expect(invoiceFiltersSchema.safeParse({}).success).toBe(true);
    for (const field of INVOICE_SORT_FIELDS) {
      for (const direction of ["asc", "desc"]) {
        expect(
          invoiceFiltersSchema.safeParse({ sort: `${field}:${direction}` }).success,
          field,
        ).toBe(true);
      }
    }
  });

  it("rejects a field that is not a column", () => {
    const result = invoiceFiltersSchema.safeParse({ sort: "withholdings:asc" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      message: VALIDATION_MESSAGES.invalidSort,
      path: ["sort"],
    });
  });
});
