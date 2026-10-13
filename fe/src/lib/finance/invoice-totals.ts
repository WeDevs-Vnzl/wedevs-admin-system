import {
  addMoney,
  compareMoney,
  isZeroMoney,
  mulMoney,
  percentOf,
  roundMoney,
  subMoney,
  sumMoney,
  toDecimal,
  toUsd,
  type MoneyString,
} from "@/lib/money";

/** The IVA of one rate may be adjusted by at most this much (DT-44). */
export const IVA_ADJUSTMENT_LIMIT = "0.01";

export type InvoiceTotalsLine = {
  quantity: MoneyString;
  unitPrice: MoneyString;
  discount: MoneyString;
  /** VAT rate in percent (`"16"`, `"8"`, `"0"`), or `null` for an exempt line. */
  ivaRate: MoneyString | null;
};

export type InvoiceTotalsInput = {
  lines: readonly InvoiceTotalsLine[];
  taxAdjustments: readonly { ivaRate: MoneyString; adjustment: MoneyString }[];
  ivaWithheld: MoneyString;
  islrWithheld: MoneyString;
  otherWithheld: MoneyString;
  /** Units of the invoice currency per 1 USD. */
  usdRate: MoneyString;
};

export type InvoiceTaxLine = {
  ivaRate: MoneyString;
  taxBase: MoneyString;
  /** Already includes `adjustment`. */
  ivaAmount: MoneyString;
  adjustment: MoneyString;
};

export type InvoiceTotals = {
  subtotal: MoneyString;
  discount: MoneyString;
  exemptAmount: MoneyString;
  /** One row per distinct rate of the taxable lines, in order of first appearance. */
  taxLines: InvoiceTaxLine[];
  taxBase: MoneyString;
  ivaAmount: MoneyString;
  total: MoneyString;
  withholdings: MoneyString;
  receivable: MoneyString;
  totalUsd: MoneyString;
  receivableUsd: MoneyString;
};

/** Canonical key of a rate, so "16" and "16.00" group together. */
function rateKey(rate: MoneyString): string {
  return toDecimal(rate).toString();
}

/**
 * Invoice totals with several VAT rates per invoice (C17 formula, DT-44). Throws `RangeError` when a
 * line discount exceeds its amount or an IVA adjustment is out of range or targets a rate with no IVA.
 */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const amounts: MoneyString[] = [];
  const discounts: MoneyString[] = [];
  const exemptNets: MoneyString[] = [];
  const bases = new Map<string, { ivaRate: MoneyString; nets: MoneyString[] }>();

  for (const line of input.lines) {
    const amount = mulMoney(line.quantity, line.unitPrice);
    if (compareMoney(line.discount, amount) > 0 || compareMoney(line.discount, "0") < 0) {
      throw new RangeError("Line discount must be between 0 and the line amount");
    }
    const net = subMoney(amount, line.discount);
    amounts.push(amount);
    discounts.push(line.discount);
    if (line.ivaRate === null) {
      exemptNets.push(net);
      continue;
    }
    const key = rateKey(line.ivaRate);
    const group = bases.get(key) ?? { ivaRate: line.ivaRate, nets: [] };
    group.nets.push(net);
    bases.set(key, group);
  }

  const adjustments = new Map<string, MoneyString>();
  for (const { ivaRate, adjustment } of input.taxAdjustments) {
    const key = rateKey(ivaRate);
    if (!bases.has(key) || isZeroMoney(ivaRate)) {
      throw new RangeError(`No taxable line uses the ${ivaRate} % rate`);
    }
    if (toDecimal(adjustment).abs().greaterThan(IVA_ADJUSTMENT_LIMIT)) {
      throw new RangeError(`IVA adjustment must be within ±${IVA_ADJUSTMENT_LIMIT}`);
    }
    adjustments.set(key, roundMoney(adjustment));
  }

  const taxLines: InvoiceTaxLine[] = [...bases.entries()].map(([key, group]) => {
    const taxBase = sumMoney(group.nets);
    const adjustment = adjustments.get(key) ?? "0.00";
    return {
      ivaRate: group.ivaRate,
      taxBase,
      ivaAmount: addMoney(percentOf(taxBase, group.ivaRate), adjustment),
      adjustment,
    };
  });

  const exemptAmount = sumMoney(exemptNets);
  const taxBase = sumMoney(taxLines.map((line) => line.taxBase));
  const ivaAmount = sumMoney(taxLines.map((line) => line.ivaAmount));
  const total = sumMoney([taxBase, exemptAmount, ivaAmount]);
  const withholdings = sumMoney([input.ivaWithheld, input.islrWithheld, input.otherWithheld]);
  const receivable = subMoney(total, withholdings);

  return {
    subtotal: sumMoney(amounts),
    discount: sumMoney(discounts),
    exemptAmount,
    taxLines,
    taxBase,
    ivaAmount,
    total,
    withholdings,
    receivable,
    totalUsd: toUsd(total, input.usdRate),
    receivableUsd: toUsd(receivable, input.usdRate),
  };
}
