import { compareMoney, isSettled, subMoney, sumMoney, type MoneyString } from "@/lib/money";
import type { DateOnly } from "@/lib/dates";
import type { InvoiceStatus, PaymentStatus } from "@/lib/validators/enums";

export type InvoiceAllocation = {
  amountInvoiceCurrency: MoneyString;
  paymentStatus: PaymentStatus;
  voided: boolean;
};

/** paidAmount = Σ allocations of confirmed payments that are not voided; balance = receivable − paid (§9.3). */
export function computeInvoiceBalance(
  receivable: MoneyString,
  allocations: readonly InvoiceAllocation[],
): { paidAmount: MoneyString; balance: MoneyString } {
  const paidAmount = sumMoney(
    allocations
      .filter((allocation) => allocation.paymentStatus === "CONFIRMADO" && !allocation.voided)
      .map((allocation) => allocation.amountInvoiceCurrency),
  );
  return { paidAmount, balance: subMoney(receivable, paidAmount) };
}

export type InvoiceStatusInput = {
  voided: boolean;
  draft: boolean;
  dueDate: DateOnly;
  receivable: MoneyString;
  paidAmount: MoneyString;
};

/**
 * Invoice status (§9.4, HU-12). Settled means a balance ≤ 0.01 (§9.5); an overdue invoice is
 * `VENCIDA` even with partial payments.
 */
export function computeInvoiceStatus(invoice: InvoiceStatusInput, today: DateOnly): InvoiceStatus {
  if (invoice.voided) return "ANULADA";
  if (invoice.draft) return "BORRADOR";
  if (isSettled(subMoney(invoice.receivable, invoice.paidAmount))) return "PAGADA";
  if (invoice.dueDate < today) return "VENCIDA";
  if (compareMoney(invoice.paidAmount, "0") > 0) return "PARCIAL";
  return "EMITIDA";
}
