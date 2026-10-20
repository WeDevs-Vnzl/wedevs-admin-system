// MOCK — complete finance rows for tests. Stores now derive totals, statuses and balances from the inputs
// (derive-finance.ts), so a test seeds whole rows and lets the derive pass fill the computed fields.
import type { AccountDTO } from "@/lib/validators/accounts";
import type { BillingPlanDTO, InstallmentDTO } from "@/lib/validators/billing";
import type { InvoiceDetailDTO, InvoiceLineDTO } from "@/lib/validators/invoices";
import type { PaymentAllocationDTO, PaymentDetailDTO } from "@/lib/validators/payments";

export const STAMP = "2026-10-01T12:00:00.000Z";
export const ref = (
  id: string,
  type: "CLIENT" | "PROJECT" | "INVOICE" | "PAYMENT" | "ACCOUNT" | "INSTALLMENT",
) => ({ id, label: id, type }) as const;

export function makeAccount(overrides: Partial<AccountDTO> = {}): AccountDTO {
  return {
    id: "acc_zelle",
    name: "Zelle",
    type: "BILLETERA_DIGITAL",
    institution: null,
    currency: "USD",
    identifierMasked: "****1234",
    holderName: null,
    openingBalance: "1000.00",
    openingDate: "2026-01-01",
    active: true,
    notes: null,
    balance: "0.00",
    balanceUsd: "0.00",
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  } as AccountDTO;
}

export function makeLine(overrides: Partial<InvoiceLineDTO>): InvoiceLineDTO {
  return {
    id: "inl_1",
    order: 0,
    description: "Desarrollo",
    project: ref("pry_web", "PROJECT"),
    installment: null,
    quantity: "1",
    unitPrice: "0",
    amount: "0.00",
    discount: "0.00",
    netAmount: "0.00",
    ivaRate: "16",
    ...overrides,
  } as InvoiceLineDTO;
}

const zeroTotals = {
  subtotal: "0.00",
  discount: "0.00",
  exemptAmount: "0.00",
  taxBase: "0.00",
  ivaAmount: "0.00",
  total: "0.00",
  ivaWithheld: "0.00",
  islrWithheld: "0.00",
  otherWithheld: "0.00",
  otherWithheldNote: null,
  receivable: "0.00",
  totalUsd: "0.00",
  receivableUsd: "0.00",
  paidAmount: "0.00",
  balance: "0.00",
  balanceUsd: "0.00",
};

export function makeInvoice(overrides: Partial<InvoiceDetailDTO> = {}): InvoiceDetailDTO {
  return {
    id: "inv_1",
    code: "FAC-0001",
    client: ref("cli_kairos", "CLIENT"),
    invoiceNumber: "A-0001",
    controlNumber: null,
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    currency: "USD",
    usdRate: "1",
    bcvRate: null,
    isDraft: false,
    status: "BORRADOR",
    voidedAt: null,
    voidReason: null,
    fileId: null,
    file: null,
    lines: [
      makeLine({
        id: "inl_1",
        unitPrice: "1000",
        ivaRate: "16",
        installment: ref("ins_1", "INSTALLMENT"),
      }),
      makeLine({ id: "inl_2", order: 1, unitPrice: "200", ivaRate: null }),
    ],
    taxLines: [],
    totals: { ...zeroTotals },
    allocations: [],
    daysOverdue: 0,
    hasPartialPayment: false,
    createdAt: STAMP,
    updatedAt: STAMP,
    createdById: null,
    ...overrides,
  } as InvoiceDetailDTO;
}

export function makePayment(overrides: Partial<PaymentDetailDTO> = {}): PaymentDetailDTO {
  return {
    id: "pag_1",
    code: "PAG-0001",
    date: "2026-10-05",
    client: ref("cli_kairos", "CLIENT"),
    method: { id: "pm_zelle", code: "ZELLE", name: "Zelle", nameEn: null },
    account: ref("acc_zelle", "ACCOUNT"),
    currency: "USD",
    amount: "500.00",
    amountUsd: "500.00",
    allocated: "0.00",
    unallocated: "0.00",
    reference: "Z-1",
    status: "CONFIRMADO",
    igtfAmount: "15.00",
    feeAmount: "2.00",
    netCredited: "0.00",
    allocatable: "0.00",
    usdRate: "1",
    receiptFileId: null,
    receipt: null,
    allocations: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    createdById: null,
    ...overrides,
  } as PaymentDetailDTO;
}

export function makeAllocation(
  overrides: Partial<PaymentAllocationDTO> = {},
): PaymentAllocationDTO {
  return {
    id: "alo_1",
    paymentId: "pag_1",
    invoice: ref("inv_1", "INVOICE"),
    invoiceCurrency: "USD",
    amountPaymentCurrency: "400.00",
    amountInvoiceCurrency: "400.00",
    amountUsd: "400.00",
    createdAt: STAMP,
    ...overrides,
  } as PaymentAllocationDTO;
}

export function makeInstallment(overrides: Partial<InstallmentDTO> = {}): InstallmentDTO {
  return {
    id: "ins_1",
    projectId: "pry_web",
    billingPlanId: "bpl_web",
    recurringChargeId: null,
    kind: "ANTICIPO",
    label: "Anticipo 40 %",
    amount: "1000.00",
    currency: "USD",
    percentage: "40",
    dueDate: null,
    trigger: null,
    periodStart: null,
    periodEnd: null,
    order: 0,
    status: "PENDIENTE",
    cancelledAt: null,
    invoicedAmount: "0.00",
    locked: false,
    ...overrides,
  } as InstallmentDTO;
}

export function makePlan(overrides: Partial<BillingPlanDTO> = {}): BillingPlanDTO {
  return {
    id: "bpl_web",
    projectId: "pry_web",
    model: "PRECIO_FIJO",
    currency: "USD",
    contractAmount: "2500.00",
    notes: null,
    installments: [],
    installmentsTotal: "0.00",
    scheduleDifference: null,
    scheduleConsistent: true,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  } as BillingPlanDTO;
}
