import {
  compareMoney,
  fromUsd,
  percentOf,
  roundMoney,
  subMoney,
  sumMoney,
  toUsd,
  type MoneyString,
} from "@/lib/money";

/** allocatable = amount − IGTF; netCredited = amount − fee; unallocated = allocatable − Σ allocated (§9.6). */
export function computePaymentAmounts(input: {
  amount: MoneyString;
  igtfAmount: MoneyString;
  feeAmount: MoneyString;
  /** Allocations in the payment currency. */
  allocated: readonly MoneyString[];
}): { allocatable: MoneyString; netCredited: MoneyString; unallocated: MoneyString } {
  const allocatable = subMoney(input.amount, input.igtfAmount);
  return {
    allocatable,
    netCredited: subMoney(input.amount, input.feeAmount),
    unallocated: subMoney(allocatable, sumMoney(input.allocated)),
  };
}

export type AllocationCheck = {
  amountPaymentCurrency: MoneyString;
  amountInvoiceCurrency: MoneyString;
  invoiceBalance: MoneyString;
};

export type AllocationProblem =
  { kind: "exceedsAllocatable" } | { kind: "exceedsInvoiceBalance"; index: number };

/** HU-13 CA3: the sum cannot exceed the allocatable amount, nor each allocation its invoice balance. */
export function allocationProblems(
  allocatable: MoneyString,
  allocations: readonly AllocationCheck[],
): AllocationProblem[] {
  const problems: AllocationProblem[] = [];
  const total = sumMoney(allocations.map((allocation) => allocation.amountPaymentCurrency));
  if (compareMoney(total, allocatable) > 0) problems.push({ kind: "exceedsAllocatable" });
  allocations.forEach((allocation, index) => {
    if (compareMoney(allocation.amountInvoiceCurrency, allocation.invoiceBalance) > 0) {
      problems.push({ kind: "exceedsInvoiceBalance", index });
    }
  });
  return problems;
}

/**
 * Proposed cross-currency allocation (§9.5, HU-13 CA4): the payment amount goes to USD with the
 * payment rate and back to the invoice currency with that currency's rate on the payment date. The
 * user may edit the result.
 */
export function proposeAllocation(input: {
  amountPaymentCurrency: MoneyString;
  paymentCurrency: string;
  paymentUsdRate: MoneyString;
  invoiceCurrency: string;
  invoiceUsdRateOnPaymentDate: MoneyString;
}): { amountUsd: MoneyString; amountInvoiceCurrency: MoneyString } {
  const amountUsd = toUsd(input.amountPaymentCurrency, input.paymentUsdRate);
  const amountInvoiceCurrency =
    input.paymentCurrency === input.invoiceCurrency
      ? roundMoney(input.amountPaymentCurrency)
      : fromUsd(amountUsd, input.invoiceUsdRateOnPaymentDate);
  return { amountUsd, amountInvoiceCurrency };
}

/**
 * Proposed IGTF of a payment (DT-70): proposed when the method has `suggestsIgtf` or the currency is listed in
 * the fiscal `igtfCurrencies`; the amount is the fiscal rate of the received amount. The user may edit it. The
 * IGTF is not income and does not reduce the amount credited to the account (§9.6): the lib computes that.
 */
export function proposeIgtfAmount(input: {
  amount: MoneyString;
  currency: string;
  suggestsIgtf: boolean;
  igtfRate: MoneyString;
  igtfCurrencies: readonly string[];
}): MoneyString {
  const proposed = input.suggestsIgtf || input.igtfCurrencies.includes(input.currency);
  return proposed ? percentOf(input.amount, input.igtfRate) : "0.00";
}
