"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { MoneyText } from "@/components/patterns/money-text";
import { SectionCard } from "@/components/patterns/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import { BILLING_MODEL_VALUES, type BillingModel } from "@/lib/validators/enums";
import { applyInstallmentTemplateAction, upsertBillingPlanAction } from "../actions";
import type { BillingPlanRow } from "../types";
import { applyFieldErrors, orUndefined } from "./form-errors";
import type { CurrencyOption } from "./installment-form-dialog";

/** The quick templates a person applies to the contract (HU-09 CA1). `CUSTOM` is built by hand, installment by installment. */
const QUICK_TEMPLATES = [
  "SPLIT_40_30_30",
  "SPLIT_30_40_30",
  "SPLIT_50_50",
  "THREE_EQUAL",
  "FULL_UPFRONT",
] as const;

type PlanCardProps = {
  projectId: string;
  plan: BillingPlanRow | null;
  currencies: readonly CurrencyOption[];
  canEdit: boolean;
};

type FormValues = {
  model: BillingModel;
  currency: string;
  contractAmount: string;
  notes: string;
};

const FIELDS = ["model", "currency", "contractAmount", "notes"] as const;

// HU-09: the billing plan of the project (model, contract, currency and its USD snapshot, D1), the quick template
// that splits the contract into installments, and the persistent warning when the installments do not add up.
export function PlanCard({ projectId, plan, currencies, canEdit }: PlanCardProps) {
  const t = useTranslations("billing.plan");
  const tTemplates = useTranslations("billing.templates");
  const tWarning = useTranslations("billing.warning");
  const tEnums = useTranslations("enums");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [template, setTemplate] = useState<(typeof QUICK_TEMPLATES)[number]>("SPLIT_40_30_30");
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    defaultValues: {
      model: plan?.model ?? "PRECIO_FIJO",
      currency: plan?.currency ?? "USD",
      contractAmount: plan?.contractAmount ?? "",
      notes: plan?.notes ?? "",
    },
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormValues) {
    const result = await upsertBillingPlanAction({
      projectId,
      model: values.model,
      currency: values.currency,
      contractAmount: orUndefined(values.contractAmount),
      notes: orUndefined(values.notes),
    });
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tRoot(result.error.message as never));
      return;
    }
    toast.success(t("saved"));
    router.refresh();
  }

  function applyTemplate() {
    startTransition(async () => {
      const result = await applyInstallmentTemplateAction({
        projectId,
        template,
        replacePending: true,
      });
      if (!result.ok) {
        toast.error(tRoot(result.error.message as never));
        return;
      }
      toast.success(tTemplates("applied"));
      router.refresh();
    });
  }

  const canApplyTemplate = canEdit && plan !== null && plan.contractAmount !== null;

  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      span={2}
      actions={
        canEdit ? (
          <Button
            type="submit"
            form="billing-plan-form"
            size="sm"
            disabled={form.formState.isSubmitting}
          >
            {plan ? t("save") : t("create")}
          </Button>
        ) : null
      }
    >
      {plan && !plan.scheduleConsistent ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>{tWarning("title")}</AlertTitle>
          <AlertDescription>
            {tWarning("description", {
              installments: formatMoney(plan.installmentsTotal, plan.currency, locale),
              contract: formatMoney(plan.contractAmount ?? "0", plan.currency, locale),
              difference: formatMoney(plan.scheduleDifference ?? "0", plan.currency, locale),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <form
        id="billing-plan-form"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field data-invalid={errors.model ? true : undefined}>
          <FieldLabel htmlFor="plan-model">{t("fields.model")}</FieldLabel>
          <Controller
            control={form.control}
            name="model"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                <SelectTrigger id="plan-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_MODEL_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {tEnums(`BillingModel.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError>{message(errors.model?.message)}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="plan-currency">{t("fields.currency")}</FieldLabel>
          <Controller
            control={form.control}
            name="currency"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                <SelectTrigger id="plan-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      {`${currency.code} · ${currency.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field data-invalid={errors.contractAmount ? true : undefined}>
          <FieldLabel htmlFor="plan-contract">{t("fields.contractAmount")}</FieldLabel>
          <Input
            id="plan-contract"
            inputMode="decimal"
            className="tabular-nums"
            disabled={!canEdit}
            aria-describedby="plan-contract-hint"
            aria-invalid={errors.contractAmount ? true : undefined}
            {...form.register("contractAmount")}
          />
          <FieldDescription id="plan-contract-hint">{t("contractAmountHint")}</FieldDescription>
          <FieldError>{message(errors.contractAmount?.message)}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="plan-notes">{t("fields.notes")}</FieldLabel>
          <Textarea id="plan-notes" rows={2} disabled={!canEdit} {...form.register("notes")} />
        </Field>
      </form>

      {plan?.contractedUsd ? (
        <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
          <dl className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{t("contractedUsd")}</dt>
            <dd>
              <MoneyText amount={plan.contractedUsd} currency="USD" />
            </dd>
          </dl>
          <dl className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{t("usdRate")}</dt>
            <dd className="tabular-nums">{plan.usdRate ?? "—"}</dd>
          </dl>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("snapshotHint")}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
        <Field className="sm:max-w-xs">
          <FieldLabel htmlFor="plan-template">{tTemplates("label")}</FieldLabel>
          <Select
            value={template}
            onValueChange={(value) => setTemplate(value as (typeof QUICK_TEMPLATES)[number])}
            disabled={!canApplyTemplate}
          >
            <SelectTrigger id="plan-template" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUICK_TEMPLATES.map((value) => (
                <SelectItem key={value} value={value}>
                  {tTemplates(`options.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{tTemplates("description")}</FieldDescription>
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={!canApplyTemplate || pending}
          onClick={applyTemplate}
        >
          {tTemplates("apply")}
        </Button>
      </div>
      {plan === null ? <FieldDescription>{t("empty")}</FieldDescription> : null}
    </SectionCard>
  );
}
