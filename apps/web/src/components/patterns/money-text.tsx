"use client";

import { useLocale } from "next-intl";
import { formatMoney, isNegativeMoney, type MoneyString } from "@/lib/money";
import { cn } from "@/lib/utils";

type MoneyTextProps = {
  amount: MoneyString;
  currency: string;
  className?: string;
};

// Money as a decimal string formatted with Intl for the current locale (C15). Negative amounts use
// the danger tone; figures are tabular and right-aligned by default.
export function MoneyText({ amount, currency, className }: MoneyTextProps) {
  const locale = useLocale();
  const negative = isNegativeMoney(amount);

  return (
    <span
      className={cn(
        "text-right whitespace-nowrap tabular-nums",
        negative && "text-destructive",
        className,
      )}
    >
      {formatMoney(amount, currency, locale)}
    </span>
  );
}
