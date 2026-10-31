import {
  compareMoney,
  percentOf,
  SETTLED_THRESHOLD,
  subMoney,
  sumMoney,
  toDecimal,
  type MoneyString,
} from '../../../shared/domain/money';
import type {
  InstallmentKind,
  InstallmentStatus,
  InvoiceStatus,
} from '../../../shared/domain/enums';

export const INSTALLMENT_TEMPLATE_VALUES = [
  'FULL_UPFRONT',
  'SPLIT_50_50',
  'SPLIT_40_30_30',
  'SPLIT_30_40_30',
  'THREE_EQUAL',
  'CUSTOM',
] as const;
export type InstallmentTemplate = (typeof INSTALLMENT_TEMPLATE_VALUES)[number];

/**
 * Percentages each template generates, in order (they add up to 100; the last absorbs the remainder
 * of an equal split). `CUSTOM` generates nothing: the caller supplies the installments.
 */
export const INSTALLMENT_TEMPLATE_PERCENTAGES: Record<InstallmentTemplate, readonly string[]> = {
  FULL_UPFRONT: ['100'],
  SPLIT_50_50: ['50', '50'],
  SPLIT_40_30_30: ['40', '30', '30'],
  SPLIT_30_40_30: ['30', '40', '30'],
  THREE_EQUAL: ['33.33', '33.33', '33.34'],
  CUSTOM: [],
};

/**
 * Installments a quick template generates for a contract amount (§8.4.2, HU-09 CA1). The last one
 * absorbs the rounding remainder, so the amounts always add up to the contract.
 */
export function splitByTemplate(
  template: InstallmentTemplate,
  contractAmount: MoneyString,
): { percentage: MoneyString; amount: MoneyString }[] {
  const percentages = INSTALLMENT_TEMPLATE_PERCENTAGES[template];
  const amounts = percentages.map((percentage) => percentOf(contractAmount, percentage));
  if (amounts.length > 0) {
    const others = sumMoney(amounts.slice(0, -1));
    amounts[amounts.length - 1] = subMoney(contractAmount, others);
  }
  return percentages.map((percentage, index) => ({ percentage, amount: amounts[index] ?? '0.00' }));
}

/**
 * Sum check of a plan (§8.4.2, HU-09 CA2): the non-`AJUSTE`, non-cancelled installments must add up
 * to the contract within ±0.01. Returns the difference (installments − contract) when they do not,
 * `null` when they do.
 */
export function installmentSumMismatch(
  contractAmount: MoneyString,
  installments: readonly { amount: MoneyString; kind: InstallmentKind; cancelled: boolean }[],
): MoneyString | null {
  const counted = installments.filter((item) => item.kind !== 'AJUSTE' && !item.cancelled);
  const difference = subMoney(sumMoney(counted.map((item) => item.amount)), contractAmount);
  return toDecimal(difference).abs().greaterThan(SETTLED_THRESHOLD) ? difference : null;
}

/** A billed installment (a non-voided invoice line references it) keeps its amount and currency (HU-09 CA3). */
export function canChangeInstallmentAmount(lines: readonly { invoiceVoided: boolean }[]): boolean {
  return lines.every((line) => line.invoiceVoided);
}

export type InstallmentStatusInput = {
  cancelled: boolean;
  /** Invoices with at least one line that references the installment. */
  invoices: readonly { status: InvoiceStatus; paidAmount: MoneyString }[];
};

/** Installment status (§8.4.2). */
export function computeInstallmentStatus(input: InstallmentStatusInput): InstallmentStatus {
  if (input.cancelled) return 'CANCELADA';
  const invoices = input.invoices.filter((invoice) => invoice.status !== 'ANULADA');
  if (invoices.length === 0) return 'PENDIENTE';
  if (invoices.every((invoice) => invoice.status === 'PAGADA')) return 'COBRADA';
  if (invoices.some((invoice) => compareMoney(invoice.paidAmount, '0') > 0))
    return 'COBRADA_PARCIAL';
  return 'FACTURADA';
}
