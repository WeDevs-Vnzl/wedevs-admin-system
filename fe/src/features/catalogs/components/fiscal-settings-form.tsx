"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CurrencyDTO } from "@/lib/validators/catalogs";
import { percentSchema } from "@/lib/validators/money";
import { fiscalSettingsSchema, type FiscalSettings } from "@/lib/validators/settings";
import { z } from "@/lib/validators/zod";
import { updateFiscalSettingsAction } from "../actions";
import { applyFieldErrors } from "./form-errors";

type FormValues = z.input<typeof fiscalSettingsSchema>;
type FormOutput = z.output<typeof fiscalSettingsSchema>;

type FiscalSettingsFormProps = {
  initial: FiscalSettings;
  /** Active currencies, for the IGTF currency list. */
  currencies: CurrencyDTO[];
  /** Display names of the active payment methods that propose IGTF (`suggestsIgtf`, DT-70). */
  igtfMethods: string[];
};

const FIELDS = [
  "ivaRates",
  "ivaDefaultRate",
  "igtfRate",
  "igtfCurrencies",
  "invoiceDefaultDueDays",
] as const;

// Settings → Fiscal (PRD §8.15, DT-44, DT-70): allowed VAT rates and the default one, the IGTF rate and the
// currencies that propose it, and the default invoice due days. Parameters to validate with the accountant.
export function FiscalSettingsForm({ initial, currencies, igtfMethods }: FiscalSettingsFormProps) {
  const t = useTranslations("settings.fiscal");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const [newRate, setNewRate] = useState("");
  const [newRateError, setNewRateError] = useState<string | null>(null);

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(fiscalSettingsSchema),
    defaultValues: initial,
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);
  const ivaRates = useWatch({ control: form.control, name: "ivaRates" }) ?? [];
  const ivaRatesError =
    errors.ivaRates?.message ??
    (Array.isArray(errors.ivaRates) ? errors.ivaRates.find(Boolean)?.message : undefined);

  function addRate() {
    const value = newRate.trim();
    const parsed = percentSchema.safeParse(value);
    if (!parsed.success) {
      setNewRateError(message(parsed.error.issues[0]?.message) ?? null);
      return;
    }
    if (ivaRates.some((rate) => Number(rate) === Number(value))) {
      setNewRateError(tRoot("settings.validation.duplicateIvaRate"));
      return;
    }
    form.setValue("ivaRates", [...ivaRates, value], { shouldDirty: true, shouldValidate: true });
    setNewRate("");
    setNewRateError(null);
  }

  function removeRate(rate: string) {
    form.setValue(
      "ivaRates",
      ivaRates.filter((item) => item !== rate),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  async function onSubmit(values: FormOutput) {
    const result = await updateFiscalSettingsAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tErrors(result.error.code));
      return;
    }
    form.reset(result.data);
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormPage
        title={t("title")}
        description={t("description")}
        backHref="/settings"
        dirty={form.formState.isDirty}
        footer={
          <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
            {t("save")}
          </Button>
        }
      >
        <SectionCard title={t("iva.title")} description={t("iva.description")} span={1} group>
          <FieldSet data-invalid={ivaRatesError ? true : undefined}>
            <FieldLegend variant="label">{t("iva.rates")}</FieldLegend>
            <ul className="flex flex-wrap gap-2">
              {ivaRates.map((rate) => (
                <li key={rate}>
                  <Badge variant="secondary" className="gap-1 pr-1 tabular-nums">
                    {rate}%
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("iva.remove", { rate })}
                      onClick={() => removeRate(rate)}
                    >
                      <X aria-hidden />
                    </Button>
                  </Badge>
                </li>
              ))}
            </ul>
            <FieldError>{message(ivaRatesError)}</FieldError>
          </FieldSet>

          <Field data-invalid={newRateError ? true : undefined}>
            <FieldLabel htmlFor="fiscal-new-rate">{t("iva.newRate")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="fiscal-new-rate"
                inputMode="decimal"
                className="tabular-nums"
                aria-invalid={newRateError ? true : undefined}
                value={newRate}
                onChange={(event) => setNewRate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addRate();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addRate}>
                {t("iva.add")}
              </Button>
            </div>
            <FieldError>{newRateError}</FieldError>
          </Field>

          <Controller
            control={form.control}
            name="ivaDefaultRate"
            render={({ field }) => (
              <Field data-invalid={errors.ivaDefaultRate ? true : undefined}>
                <FieldLabel htmlFor="fiscal-default-rate">{t("iva.default")}</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="fiscal-default-rate"
                    className="w-full"
                    aria-invalid={errors.ivaDefaultRate ? true : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ivaRates.map((rate) => (
                      <SelectItem key={rate} value={rate}>
                        {rate}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t("iva.defaultHint")}</FieldDescription>
                <FieldError>{message(errors.ivaDefaultRate?.message)}</FieldError>
              </Field>
            )}
          />
        </SectionCard>

        <SectionCard title={t("igtf.title")} description={t("igtf.description")} span={1} group>
          <Field data-invalid={errors.igtfRate ? true : undefined}>
            <FieldLabel htmlFor="fiscal-igtf-rate">{t("igtf.rate")}</FieldLabel>
            <Input
              id="fiscal-igtf-rate"
              inputMode="decimal"
              className="tabular-nums"
              aria-invalid={errors.igtfRate ? true : undefined}
              {...form.register("igtfRate")}
            />
            <FieldError>{message(errors.igtfRate?.message)}</FieldError>
          </Field>

          <Controller
            control={form.control}
            name="igtfCurrencies"
            render={({ field }) => {
              const selected = field.value ?? [];
              return (
                <FieldSet>
                  <FieldLegend variant="label">{t("igtf.currencies")}</FieldLegend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {currencies.map((currency) => (
                      <Field key={currency.code} orientation="horizontal">
                        <Checkbox
                          id={`fiscal-igtf-${currency.code}`}
                          checked={selected.includes(currency.code)}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked === true
                                ? [...selected, currency.code]
                                : selected.filter((code) => code !== currency.code),
                            )
                          }
                        />
                        <FieldLabel
                          htmlFor={`fiscal-igtf-${currency.code}`}
                          className="font-normal"
                        >
                          {currency.code} · {currency.name}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                </FieldSet>
              );
            }}
          />

          <div className="grid gap-2">
            <p className="text-sm font-medium">{t("igtf.methods")}</p>
            {igtfMethods.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("igtf.methodsNone")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {igtfMethods.map((name) => (
                  <li key={name}>
                    <Badge variant="outline">{name}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/settings/payment-methods" className="text-sm underline underline-offset-4">
              {t("igtf.manageMethods")}
            </Link>
          </div>
        </SectionCard>

        <SectionCard title={t("invoices.title")} span={1} group>
          <Field data-invalid={errors.invoiceDefaultDueDays ? true : undefined}>
            <FieldLabel htmlFor="fiscal-due-days">{t("invoices.dueDays")}</FieldLabel>
            <Input
              id="fiscal-due-days"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              className="tabular-nums"
              aria-describedby="fiscal-due-days-hint"
              aria-invalid={errors.invoiceDefaultDueDays ? true : undefined}
              {...form.register("invoiceDefaultDueDays", { valueAsNumber: true })}
            />
            <FieldDescription id="fiscal-due-days-hint">
              {t("invoices.dueDaysHint")}
            </FieldDescription>
            <FieldError>{message(errors.invoiceDefaultDueDays?.message)}</FieldError>
          </Field>
        </SectionCard>
      </FormPage>
    </form>
  );
}
