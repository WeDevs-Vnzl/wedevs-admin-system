"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/dates";
import { DEFAULT_RATE_DEVIATION_PERCENT, rateDeviationExceeds } from "@/lib/rates";
import { RATE_SOURCE_VALUES, type RateSource } from "@/lib/validators/enums";
import { loadDailyRatesAction } from "../actions";
import type { QuickLoadCurrency } from "../queries";

type QuickRateLoadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  today: string;
  currencies: QuickLoadCurrency[];
};

const RATE_PATTERN = /^\d+(\.\d+)?$/;

function QuickRateLoadForm({ onOpenChange, onSaved, today, currencies }: QuickRateLoadDialogProps) {
  const t = useTranslations("catalogs.rates.quickLoad");
  const tRates = useTranslations("catalogs.rates");
  const tEnums = useTranslations("enums");
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("common.errors");
  const tRoot = useTranslations();
  const locale = useLocale();
  const [date, setDate] = useState(today);
  const [source, setSource] = useState<RateSource>("BCV");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const rates = currencies
      .map((currency) => ({
        currency: currency.code,
        usdRate: (values[currency.code] ?? "").trim(),
      }))
      .filter((row) => row.usdRate !== "");
    if (rates.length === 0) {
      setError(t("noRates"));
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await loadDailyRatesAction({ date, source, rates });
    setSubmitting(false);
    if (!result.ok) {
      const first = Object.values(result.error.fieldErrors ?? {})[0]?.[0];
      setError(first ? tRoot(first as never) : tErrors(result.error.code));
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(tRates("toast.saved", { count: result.data.created + result.data.updated }));
    onSaved();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="quick-load-date">{t("date")}</FieldLabel>
          <DateField id="quick-load-date" value={date} max={today} onChange={setDate} />
        </Field>
        <Field>
          <FieldLabel htmlFor="quick-load-source">{t("source")}</FieldLabel>
          <Select value={source} onValueChange={(value) => setSource(value as RateSource)}>
            <SelectTrigger id="quick-load-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RATE_SOURCE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {tEnums(`RateSource.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("sourceHint")}</FieldDescription>
        </Field>
      </div>

      {currencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noCurrencies")}</p>
      ) : (
        <div className="grid gap-3">
          {currencies.map((currency) => {
            const value = values[currency.code] ?? "";
            const id = `quick-load-${currency.code}`;
            const deviates =
              RATE_PATTERN.test(value) && rateDeviationExceeds(value, currency.lastRate?.usdRate);
            return (
              <Field key={currency.code}>
                <FieldLabel htmlFor={id}>{t("rate", { currency: currency.code })}</FieldLabel>
                <Input
                  id={id}
                  inputMode="decimal"
                  className="tabular-nums"
                  aria-describedby={`${id}-hint`}
                  value={value}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [currency.code]: event.target.value }))
                  }
                />
                <FieldDescription id={`${id}-hint`}>
                  {currency.lastRate
                    ? t("lastRate", {
                        rate: currency.lastRate.usdRate,
                        date: formatDate(currency.lastRate.date, locale),
                      })
                    : t("noLastRate")}
                </FieldDescription>
                {deviates ? (
                  <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
                    {t("deviation", { percent: DEFAULT_RATE_DEVIATION_PERCENT })}
                  </p>
                ) : null}
              </Field>
            );
          })}
        </div>
      )}

      {error ? <FieldError>{error}</FieldError> : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          {tActions("cancel")}
        </Button>
        <Button type="submit" disabled={submitting || currencies.length === 0}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Quick daily load (PRD §8.15): one rate per active currency for a date and source; BCV preselected (DT-67).
// A rate more than 10 % away from the last one shows a warning but can still be saved (PRD §15).
export function QuickRateLoadDialog(props: QuickRateLoadDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain">
        {props.open ? <QuickRateLoadForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}
