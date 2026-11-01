import Decimal from 'decimal.js';
import {
  addMoney,
  compareMoney,
  subMoney,
  sumMoney,
  toDecimal,
  type MoneyString,
} from '../../../shared/domain/money';

/**
 * Read-model fact kinds (data-rules Δ5). Internal to the finance read models: declared here, not in
 * `shared/domain/enums.ts`, and never exposed in DTOs (DT-104). Mirrors the Prisma enum.
 */
export const FINANCE_FACT_KIND_VALUES = [
  'BILLED',
  'COLLECTED',
  'EXPENSE_PAID',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'MOVEMENT_IN',
  'MOVEMENT_OUT',
  'IVA',
  'WITHHELD_IVA',
  'WITHHELD_ISLR',
  'WITHHELD_OTHER',
  'IGTF',
] as const;
export type FinanceFactKind = (typeof FINANCE_FACT_KIND_VALUES)[number];

export const FINANCE_FACT_SOURCE_VALUES = [
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'TRANSFER',
  'MOVEMENT',
] as const;
export type FinanceFactSource = (typeof FINANCE_FACT_SOURCE_VALUES)[number];

/**
 * Splits `total` (2 dp) proportionally to `weights`. Each share truncates total × weight / Σ weights to
 * 2 dp toward zero, so the residue keeps the sign of `total` and no line turns negative; the residue
 * goes to the largest weight (the first on ties), so the parts always sum to `total` (Q-BE3-7). When every weight is zero the first line takes the whole amount.
 */
export function splitProportionally(
  total: MoneyString,
  weights: readonly MoneyString[],
): MoneyString[] {
  const amount = sumMoney([total]);
  if (weights.length === 0) {
    if (toDecimal(amount).isZero()) return [];
    throw new RangeError('Cannot split a non-zero amount over no lines');
  }
  const weightSum = toDecimal(sumWeights(weights));
  const shares = weights.map((weight, index) => {
    if (weightSum.isZero()) return index === 0 ? amount : '0.00';
    const share = toDecimal(amount).times(toDecimal(weight)).dividedBy(weightSum);
    return sumMoney([share.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed()]);
  });
  const residue = subMoney(amount, sumMoney(shares));
  if (!toDecimal(residue).isZero()) {
    const target = indexOfLargest(weights);
    shares[target] = addMoney(shares[target] ?? '0.00', residue);
  }
  return shares;
}

/** Σ weights at full precision (not rounded to 2 dp, so tiny weights keep their proportion). */
function sumWeights(weights: readonly MoneyString[]): MoneyString {
  return weights.reduce((acc, weight) => toDecimal(acc).plus(toDecimal(weight)).toFixed(), '0');
}

function indexOfLargest(weights: readonly MoneyString[]): number {
  let best = 0;
  weights.forEach((weight, index) => {
    if (compareMoney(weight, weights[best] ?? weight) > 0) best = index;
  });
  return best;
}

export type FactLine = { projectId: string | null; netAmount: MoneyString };
export type FactSplit = { projectId: string | null; amountUsd: MoneyString };

/**
 * One row per invoice line: `BILLED` splits the invoice `totalUsd`, `COLLECTED` splits an
 * allocation's `amountUsd`, both by the line `netAmount` (Q-BE3-7, DT-98). A line without a project
 * keeps `projectId: null`; no lines keeps the whole amount on one null-project row.
 */
export function splitByNetAmount(totalUsd: MoneyString, lines: readonly FactLine[]): FactSplit[] {
  if (lines.length === 0) {
    const amount = sumMoney([totalUsd]);
    return toDecimal(amount).isZero() ? [] : [{ projectId: null, amountUsd: amount }];
  }
  const parts = splitProportionally(
    totalUsd,
    lines.map((line) => line.netAmount),
  );
  return lines.map((line, index) => ({
    projectId: line.projectId,
    amountUsd: parts[index] ?? '0.00',
  }));
}
