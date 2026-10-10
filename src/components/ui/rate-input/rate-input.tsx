"use client";

import { useEffect, useEffectEvent, useRef, useState, type Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDecimalText } from "@/components/ui/money-input/use-decimal-text";
import { cn } from "@/lib/utils";
import { isDecimalString, RATE_DECIMALS } from "@/lib/money";
import { DEFAULT_RATE_DEVIATION_PERCENT, rateDeviationExceeds } from "@/lib/rates";
import type { RateSource } from "@/lib/validators/enums";

/**
 * Result of the rate lookup (PRD §9.2 + DT-67). Declared here on purpose: `lib/rates` changes in
 * parallel (package 3.7) and the two shapes must only match structurally.
 */
export type RateLookupResult = {
  usdRate: string;
  /** True when the rate comes from an earlier date ("Usando tasa del dd/mm"). */
  isFallback: boolean;
  /** Date-only 'YYYY-MM-DD' of the row the rate was taken from. */
  effectiveDate: string;
  /** Source preselected by the lookup (BCV by default), `null` when unknown. */
  source: RateSource | null;
  /** Every usable rate of `effectiveDate`, one per source. */
  options: { source: RateSource; usdRate: string; createdAt: string }[];
};

/** `null` when no rate exists on or before `date`: the user types it. */
export type RateLookup = (date: string, currency: string) => Promise<RateLookupResult | null>;

export interface RateInputProps {
  /** Canonical rate string (units of `currency` per 1 USD), `""` while empty. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Transaction date, 'YYYY-MM-DD'. */
  date: string;
  currency: string;
  lookupRate: RateLookup;
  /** Rate the deviation warning compares against; defaults to the looked-up rate. */
  referenceRate?: string | null;
  /**
   * Whether the first lookup overwrites `value`. Edit forms pass `false` so an existing transaction
   * keeps its own stored rate (C16).
   */
  prefillOnMount?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

const USD = "USD";

type LookupState = { key: string; result: RateLookupResult | null };
type SourceChoice = { key: string; source: RateSource | null };

/** 'YYYY-MM-DD' → "dd/mm" (ES) or "mm/dd" (EN), without going through a Date. */
function shortDayMonth(dateOnly: string, locale: string): string {
  const [, month = "", day = ""] = dateOnly.split("-");
  return locale.toLowerCase().startsWith("es") ? `${day}/${month}` : `${month}/${day}`;
}

export function RateInput({
  value,
  onChange,
  onBlur,
  date,
  currency,
  lookupRate,
  referenceRate,
  prefillOnMount = true,
  disabled,
  id,
  name,
  className,
  ref,
  ...aria
}: RateInputProps) {
  const t = useTranslations("forms.rateInput");
  const tSources = useTranslations("enums.RateSource");
  const locale = useLocale();

  const isUsd = currency === USD;
  const key = `${date}|${currency}`;
  const initialKey = useRef(key);
  const [lookup, setLookup] = useState<LookupState | null>(null);
  const [choice, setChoice] = useState<SourceChoice | null>(null);

  const field = useDecimalText({
    value: isUsd ? "1" : value,
    onValueChange: (next) => {
      if (isUsd) return;
      setChoice({ key, source: null });
      onChange(next);
    },
    locale,
    maxDecimals: RATE_DECIMALS,
    minFractionDigits: 0,
    maxFractionDigits: RATE_DECIMALS,
  });

  const lookupEvent = useEffectEvent((d: string, c: string) => lookupRate(d, c));
  const applyLookup = useEffectEvent((result: RateLookupResult | null, lookupKey: string) => {
    setLookup({ key: lookupKey, result });
    const keepStoredRate = !prefillOnMount && value !== "" && lookupKey === initialKey.current;
    if (keepStoredRate) return;
    if (result) onChange(result.usdRate);
    else if (value !== "") onChange("");
  });
  const lockUsd = useEffectEvent(() => {
    if (value !== "1") onChange("1");
  });

  useEffect(() => {
    if (currency !== USD) return;
    lockUsd();
  }, [currency, value]);

  useEffect(() => {
    if (currency === USD) return;
    let cancelled = false;
    const lookupKey = `${date}|${currency}`;
    lookupEvent(date, currency).then(
      (result) => {
        if (!cancelled) applyLookup(result, lookupKey);
      },
      () => {
        if (!cancelled) applyLookup(null, lookupKey);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [date, currency]);

  const current = !isUsd && lookup?.key === key ? lookup : null;
  const loading = !isUsd && lookup?.key !== key;
  const result = current?.result ?? null;
  const options = result?.options ?? [];
  const activeSource = choice?.key === key ? choice.source : (result?.source ?? null);

  const reference = referenceRate ?? result?.usdRate ?? null;
  const deviates =
    !isUsd && isDecimalString(value) && reference !== null && isDecimalString(reference)
      ? rateDeviationExceeds(value, reference)
      : false;

  const invalid = aria["aria-invalid"] || field.invalid;

  let note: string | null = null;
  if (isUsd) note = t("usdLocked");
  else if (loading) note = t("loading");
  else if (result?.isFallback) {
    note = t("usingRateFrom", { date: shortDayMonth(result.effectiveDate, locale) });
  } else if (current && result === null) note = t("manual");

  return (
    <div data-slot="rate-input" className={cn("flex flex-col gap-1.5", className)}>
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
        disabled={disabled || isUsd}
        aria-label={aria["aria-label"] ?? (id ? undefined : t("label"))}
        aria-invalid={invalid || undefined}
        className="text-right"
      />
      {options.length > 1 ? (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label={t("sourceLabel")}
          value={activeSource ?? ""}
          disabled={disabled}
          onValueChange={(next) => {
            const picked = options.find((option) => option.source === next);
            if (!picked) return;
            setChoice({ key, source: picked.source });
            onChange(picked.usdRate);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option.source} value={option.source}>
              {tSources(option.source)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}
      {note ? (
        <p data-slot="rate-input-note" className="text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
      {deviates && reference ? (
        <p role="alert" data-slot="rate-input-warning" className="text-xs text-warning-foreground">
          {t("deviationWarning", { percent: DEFAULT_RATE_DEVIATION_PERCENT, rate: reference })}
        </p>
      ) : null}
    </div>
  );
}
