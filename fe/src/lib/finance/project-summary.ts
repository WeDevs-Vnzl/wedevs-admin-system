import {
  addMoney,
  compareMoney,
  roundMoney,
  subMoney,
  sumMoney,
  toDecimal,
  type MoneyString,
} from "@/lib/money";
import type { BillingModel } from "@/lib/validators/enums";

/** One project line of a non-voided invoice, with what its invoice has paid (its own currency). */
export type ProjectSummaryLine = {
  /** Net amount of the line in USD at the invoice rate (snapshot, C16). */
  netAmountUsd: MoneyString;
  invoiceReceivable: MoneyString;
  invoicePaid: MoneyString;
};

/** Every amount is USD from the stored snapshots (C16); the plan contract is the D1 snapshot. */
export type ProjectSummaryInput = {
  /** `null` for a project without a billing plan. */
  model: BillingModel | null;
  contractedUsd: MoneyString | null;
  /** Non-cancelled `AJUSTE` installments (signed). */
  adjustmentsUsd: readonly MoneyString[];
  lines: readonly ProjectSummaryLine[];
  /** Active recurring charges, each normalized to a month. */
  monthlyRecurringUsd: readonly MoneyString[];
  /** Paid expenses charged to the project. */
  allocatedExpensesUsd: MoneyString;
};

export type ProjectSummary = {
  contractedValue: MoneyString;
  invoiced: MoneyString;
  collected: MoneyString;
  /** `null` unless the plan is fixed-price or mixed. */
  toInvoice: MoneyString | null;
  receivable: MoneyString;
  monthlyRecurring: MoneyString;
  allocatedExpenses: MoneyString;
  margin: MoneyString;
  /** `null` while nothing is collected. */
  marginPercent: MoneyString | null;
};

/** Collected part of a line: proportional to the paid share of its invoice, capped at the whole line. */
function collectedOf(line: ProjectSummaryLine): MoneyString {
  const receivable = toDecimal(line.invoiceReceivable);
  if (!receivable.greaterThan(0)) return roundMoney(line.netAmountUsd);
  const share = toDecimal(line.invoicePaid).dividedBy(receivable);
  const capped = share.greaterThan(1) ? toDecimal("1") : share;
  return roundMoney(toDecimal(line.netAmountUsd).times(capped).toFixed());
}

/** Financial summary of a project (PRD §8.4.4): the billing tab and the projects table read it. */
export function computeProjectSummary(input: ProjectSummaryInput): ProjectSummary {
  const contractedValue = addMoney(input.contractedUsd ?? "0", sumMoney(input.adjustmentsUsd));
  const invoiced = sumMoney(input.lines.map((line) => line.netAmountUsd));
  const collected = sumMoney(input.lines.map(collectedOf));
  const allocatedExpenses = roundMoney(input.allocatedExpensesUsd);
  const margin = subMoney(collected, allocatedExpenses);
  const billsContract = input.model === "PRECIO_FIJO" || input.model === "MIXTO";
  return {
    contractedValue,
    invoiced,
    collected,
    toInvoice: billsContract ? subMoney(contractedValue, invoiced) : null,
    receivable: subMoney(invoiced, collected),
    monthlyRecurring: sumMoney(input.monthlyRecurringUsd),
    allocatedExpenses,
    margin,
    marginPercent:
      compareMoney(collected, "0") > 0
        ? roundMoney(toDecimal(margin).times(100).dividedBy(toDecimal(collected)).toFixed())
        : null,
  };
}
