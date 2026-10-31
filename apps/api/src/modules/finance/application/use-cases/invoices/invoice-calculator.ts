import type { DateOnly } from '../../../../../shared/domain/business-date';
import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import {
  compareMoney,
  percentOf,
  subMoney,
  toDecimal,
  type MoneyString,
} from '../../../../../shared/domain/money';
import { INVOICE_ERRORS } from '../../../domain/errors';
import { computeInvoiceBalance, computeInvoiceStatus } from '../../../domain/invoice-status';
import {
  computeInvoiceTotals,
  IVA_ADJUSTMENT_LIMIT,
  type InvoiceTotals,
  type InvoiceTotalsLine,
} from '../../../domain/invoice-totals';
import type {
  InvoiceAllocationState,
  InvoiceRecord,
  InvoiceTaxLineRecord,
} from '../../ports/invoice.repository.port';

export interface TotalsSource {
  readonly lines: readonly InvoiceTotalsLine[];
  readonly taxAdjustments: readonly { ivaRate: MoneyString; adjustment: MoneyString }[];
  readonly ivaWithheld: MoneyString;
  readonly islrWithheld: MoneyString;
  readonly otherWithheld: MoneyString;
  readonly usdRate: MoneyString;
}

/**
 * Runs the C17 totals once, so a bad discount, adjustment or withholding becomes a field error instead of a
 * `RangeError` (the domain throws it for anything the shape rules could not see).
 */
export function totalsOrInvalid(source: TotalsSource): InvoiceTotals {
  try {
    return computeInvoiceTotals(source);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ValidationFailedError({
        fieldErrors: { lines: [INVOICE_ERRORS.invalidTotals] },
      });
    }
    throw error;
  }
}

/** `ivaAmount − round(taxBase × rate / 100, 2)`: the manual adjustment a stored tax line carries. */
export function adjustmentOf(line: InvoiceTaxLineRecord): MoneyString {
  return subMoney(line.ivaAmount, percentOf(line.taxBase, line.ivaRate));
}

/**
 * The adjustments of the stored tax lines that are still valid for `lines`: kept while the tax base and the
 * rate are unchanged and within the ±0.01 limit, reset otherwise (`data-rules.md` §8).
 */
export function carriedAdjustments(
  stored: readonly InvoiceTaxLineRecord[],
  lines: readonly InvoiceTotalsLine[],
): { ivaRate: MoneyString; adjustment: MoneyString }[] {
  const bare = computeInvoiceTotals({
    lines,
    taxAdjustments: [],
    ivaWithheld: '0.00',
    islrWithheld: '0.00',
    otherWithheld: '0.00',
    usdRate: '1',
  });
  const carried: { ivaRate: MoneyString; adjustment: MoneyString }[] = [];
  for (const line of stored) {
    const current = bare.taxLines.find((candidate) =>
      toDecimal(candidate.ivaRate).equals(toDecimal(line.ivaRate)),
    );
    if (!current || compareMoney(current.taxBase, line.taxBase) !== 0) continue;
    const adjustment = adjustmentOf(line);
    if (toDecimal(adjustment).isZero()) continue;
    if (toDecimal(adjustment).abs().greaterThan(IVA_ADJUSTMENT_LIMIT)) continue;
    carried.push({ ivaRate: current.ivaRate, adjustment });
  }
  return carried;
}

/** The columns an invoice derives from its lines, withholdings and allocations (§9.3, §9.4, C17). */
export type DerivedColumns = Pick<
  InvoiceRecord,
  | 'subtotal'
  | 'discount'
  | 'exemptAmount'
  | 'taxBase'
  | 'ivaAmount'
  | 'total'
  | 'receivable'
  | 'totalUsd'
  | 'receivableUsd'
  | 'paidAmount'
  | 'balance'
  | 'status'
  | 'taxLines'
>;

export function deriveColumns(
  totals: InvoiceTotals,
  state: { voided: boolean; draft: boolean; dueDate: DateOnly },
  allocations: readonly InvoiceAllocationState[],
  today: DateOnly,
): DerivedColumns {
  const { paidAmount, balance } = computeInvoiceBalance(
    totals.receivable,
    allocations.map((allocation) => ({
      amountInvoiceCurrency: allocation.amountInvoiceCurrency,
      paymentStatus: allocation.paymentStatus,
      voided: false,
    })),
  );
  return {
    subtotal: totals.subtotal,
    discount: totals.discount,
    exemptAmount: totals.exemptAmount,
    taxBase: totals.taxBase,
    ivaAmount: totals.ivaAmount,
    total: totals.total,
    receivable: totals.receivable,
    totalUsd: totals.totalUsd,
    receivableUsd: totals.receivableUsd,
    paidAmount,
    balance,
    status: computeInvoiceStatus(
      {
        voided: state.voided,
        draft: state.draft,
        dueDate: state.dueDate,
        receivable: totals.receivable,
        paidAmount,
      },
      today,
    ),
    taxLines: totals.taxLines.map((line) => ({
      ivaRate: line.ivaRate,
      taxBase: line.taxBase,
      ivaAmount: line.ivaAmount,
    })),
  };
}
