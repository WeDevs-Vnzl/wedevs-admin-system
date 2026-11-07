import type {
  InvoiceListItemDto,
  InvoiceListResponseDto,
  InvoiceResponseDto,
} from "@/lib/api/types/invoices";

// MOCK — test fixtures only (HU-11 multi-rate example); no real customer data. Wire shapes of the generated DTOs:
// `code` is `string | null`, money is a decimal string.

const ref = (
  type: "CLIENT" | "PROJECT" | "INSTALLMENT",
  id: string,
  label: string,
  code?: string,
) => ({
  type,
  id,
  label,
  code: code ?? null,
});

/** 1000 at 16 %, 500 at 8 %, 200 at 0 % and 100 exempt, with a +0.01 adjustment on the 16 % rate. */
export function multiRateInvoice(overrides: Partial<InvoiceResponseDto> = {}): InvoiceResponseDto {
  return {
    id: "inv_1",
    code: "FAC-0001",
    invoiceNumber: "00001234",
    controlNumber: null,
    client: ref("CLIENT", "cli_1", "Kairos Studio", "CLI-0001"),
    issueDate: "2026-10-09",
    dueDate: "2026-10-24",
    currency: "USD",
    usdRate: "1",
    bcvRate: null,
    isDraft: true,
    status: "BORRADOR",
    voidedAt: null,
    voidReason: null,
    archivedAt: null,
    fileId: null,
    file: null,
    lines: [
      line(
        "l1",
        1,
        "Desarrollo MVP",
        "1000.00",
        "16",
        ref("PROJECT", "prj_1", "Portal", "PRJ-0001"),
      ),
      line("l2", 2, "Soporte", "500.00", "8"),
      line("l3", 3, "Exportación", "200.00", "0"),
      line("l4", 4, "Hosting exento", "100.00", null),
    ],
    taxLines: [
      { ivaRate: "16", taxBase: "1000.00", ivaAmount: "160.01", adjustment: "0.01" },
      { ivaRate: "8", taxBase: "500.00", ivaAmount: "40.00", adjustment: "0.00" },
      { ivaRate: "0", taxBase: "200.00", ivaAmount: "0.00", adjustment: "0.00" },
    ],
    totals: {
      subtotal: "1800.00",
      discount: "0.00",
      exemptAmount: "100.00",
      taxBase: "1700.00",
      ivaAmount: "200.01",
      total: "2000.01",
      ivaWithheld: "0.00",
      islrWithheld: "0.00",
      otherWithheld: "0.00",
      otherWithheldNote: null,
      receivable: "2000.01",
      totalUsd: "2000.01",
      receivableUsd: "2000.01",
      paidAmount: "0.00",
      balance: "2000.01",
      balanceUsd: "2000.01",
    },
    allocations: [],
    daysOverdue: 0,
    hasPartialPayment: false,
    createdAt: "2026-10-09T12:00:00.000Z",
    updatedAt: "2026-10-09T12:00:00.000Z",
    createdById: "usr_owner",
    ...overrides,
  };
}

function line(
  id: string,
  order: number,
  description: string,
  amount: string,
  ivaRate: string | null,
  project: InvoiceResponseDto["lines"][number]["project"] = null,
): InvoiceResponseDto["lines"][number] {
  return {
    id,
    order,
    description,
    project,
    installment: null,
    quantity: "1",
    unitPrice: amount,
    amount,
    discount: "0.00",
    netAmount: amount,
    ivaRate,
  };
}

export function invoiceListItem(overrides: Partial<InvoiceListItemDto> = {}): InvoiceListItemDto {
  return {
    id: "inv_1",
    code: "FAC-0001",
    invoiceNumber: "00001234",
    client: ref("CLIENT", "cli_1", "Kairos Studio", "CLI-0001"),
    projects: [],
    issueDate: "2026-10-09",
    dueDate: "2026-10-24",
    currency: "USD",
    total: "2000.01",
    balance: "2000.01",
    totalUsd: "2000.01",
    balanceUsd: "2000.01",
    status: "EMITIDA",
    daysOverdue: 0,
    hasPartialPayment: false,
    archivedAt: null,
    ...overrides,
  };
}

export function invoicePage(
  items: InvoiceListItemDto[],
  overrides: Partial<InvoiceListResponseDto> = {},
): InvoiceListResponseDto {
  return { items, page: 1, pageSize: 25, pageCount: 1, total: items.length, ...overrides };
}
