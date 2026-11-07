import type {
  OpenInvoiceResponseDto,
  PaymentListResponseDto,
  PaymentListRowDto,
  PaymentResponseDto,
} from "@/lib/api/types/payments";

// Wire-shaped fixtures for the payment tests (MOCK data, never real records). They follow the BE response DTOs, so
// the tests exercise the same parsing the screens do.

const METHOD = { id: "pm_zelle", code: "ZELLE", name: "Zelle", nameEn: "Zelle" };

export function makePayment(overrides: Partial<PaymentResponseDto> = {}): PaymentResponseDto {
  return {
    id: "pay_1",
    code: "PAG-0001",
    date: "2026-10-05",
    client: { id: "cli_1", code: "CLI-0001", label: "Kairos Studio (MOCK)", type: "CLIENT" },
    account: { id: "acc_usd", code: null, label: "Zelle USD (MOCK)", type: "ACCOUNT" },
    method: METHOD,
    currency: "USD",
    amount: "100.00",
    amountUsd: "100.00",
    igtfAmount: "3.00",
    feeAmount: "0.00",
    netCredited: "100.00",
    allocatable: "97.00",
    allocated: "0.00",
    unallocated: "97.00",
    usdRate: "1",
    reference: "ZL-MOCK-0001",
    status: "CONFIRMADO",
    receipt: null,
    receiptFileId: null,
    allocations: [],
    createdAt: "2026-10-05T12:00:00.000Z",
    updatedAt: "2026-10-05T12:00:00.000Z",
    createdById: "usr_owner",
    ...overrides,
  };
}

export function makePaymentRow(overrides: Partial<PaymentListRowDto> = {}): PaymentListRowDto {
  const payment = makePayment();
  return {
    id: payment.id,
    code: payment.code,
    date: payment.date,
    client: payment.client,
    account: payment.account,
    method: payment.method,
    currency: payment.currency,
    amount: payment.amount,
    amountUsd: payment.amountUsd,
    allocated: payment.allocated,
    unallocated: payment.unallocated,
    reference: payment.reference,
    status: payment.status,
    ...overrides,
  };
}

export function page(items: PaymentListRowDto[]): PaymentListResponseDto {
  return { items, total: items.length, page: 1, pageSize: 25, pageCount: 1 };
}

export function makeOpenInvoice(
  overrides: Partial<OpenInvoiceResponseDto> = {},
): OpenInvoiceResponseDto {
  return {
    id: "inv_1",
    code: "FAC-0001",
    invoiceNumber: "00-000001",
    currency: "USD",
    usdRate: "1",
    issueDate: "2026-09-20",
    dueDate: "2026-10-20",
    receivable: "300.00",
    balance: "300.00",
    status: "EMITIDA",
    ...overrides,
  };
}
