"use client";

import type { Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatMoney, isDecimalString, toUsd } from "@/lib/money";
import { useDecimalText } from "./use-decimal-text";

/** Currency + amount, both strings (C15): the amount is a canonical decimal, never a number. */
export interface MoneyInputValue {
  amount: string;
  currency: string;
}

export interface MoneyInputCurrency {
  code: string;
  /** Optional visible name next to the code in the list. */
  label?: string;
}

export interface MoneyInputProps {
  value: MoneyInputValue;
  onChange: (value: MoneyInputValue) => void;
  onBlur?: () => void;
  currencies: readonly MoneyInputCurrency[];
  /** Units of the selected currency per 1 USD; enables the live USD equivalent when set. */
  usdRate?: string | null;
  allowNegative?: boolean;
  disabled?: boolean;
  /** Locks the currency select (e.g. a billed installment cannot change currency, C19). */
  currencyDisabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

const USD = "USD";
const AMOUNT_DECIMALS = 2;

function usdEquivalent(
  amount: string,
  currency: string,
  usdRate: string | null | undefined,
  locale: string,
): string | null {
  if (currency === USD || !usdRate || !isDecimalString(amount) || !isDecimalString(usdRate)) {
    return null;
  }
  try {
    return formatMoney(toUsd(amount, usdRate), USD, locale);
  } catch {
    return null; // non-positive rate
  }
}

/**
 * Currency select + amount text input (frontend-patterns §6). Works with react-hook-form `Controller`:
 * `value` / `onChange` carry `{ amount, currency }` and the amount is a canonical decimal string.
 */
export function MoneyInput({
  value,
  onChange,
  onBlur,
  currencies,
  usdRate,
  allowNegative = false,
  disabled,
  currencyDisabled,
  id,
  name,
  className,
  ref,
  ...aria
}: MoneyInputProps) {
  const t = useTranslations("forms.moneyInput");
  const locale = useLocale();

  const field = useDecimalText({
    value: value.amount,
    onValueChange: (amount) => onChange({ amount, currency: value.currency }),
    locale,
    maxDecimals: AMOUNT_DECIMALS,
    allowNegative,
    minFractionDigits: AMOUNT_DECIMALS,
    maxFractionDigits: AMOUNT_DECIMALS,
  });

  const equivalent = usdEquivalent(value.amount, value.currency, usdRate, locale);
  const invalid = aria["aria-invalid"] || field.invalid;

  return (
    <div data-slot="money-input" className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
        <Select
          value={value.currency}
          onValueChange={(currency) => onChange({ amount: value.amount, currency })}
          disabled={disabled || currencyDisabled}
        >
          <SelectTrigger aria-label={t("currencyLabel")} aria-invalid={invalid} className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencies.map((currency) => (
              <SelectItem key={currency.code} value={currency.code}>
                {currency.label ? `${currency.code} · ${currency.label}` : currency.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={field.text}
          onChange={(event) => field.onTextChange(event.target.value)}
          onBlur={() => {
            field.onBlur();
            onBlur?.();
          }}
          disabled={disabled}
          aria-label={aria["aria-label"] ?? (id ? undefined : t("amountLabel"))}
          aria-invalid={invalid || undefined}
          placeholder={t("placeholder")}
          className="flex-1 text-right"
        />
      </div>
      {equivalent ? (
        <p data-slot="money-input-usd" className="text-right text-xs text-muted-foreground">
          {t("usdEquivalent", { amount: equivalent })}
        </p>
      ) : null}
    </div>
  );
}
