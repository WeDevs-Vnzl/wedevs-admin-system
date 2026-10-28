"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
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
import type { DateOnly } from "@/lib/dates";
import type { RecurringChargeDTO } from "@/lib/validators/billing";
import { FREQUENCY_VALUES } from "@/lib/validators/enums";
import { createRecurringChargeAction, updateRecurringChargeAction } from "../actions";
import { applyFieldErrors, orUndefined } from "./form-errors";
import type { CurrencyOption } from "./installment-form-dialog";

export type RecurringChargeFormTarget =
  { mode: "create" } | { mode: "edit"; charge: RecurringChargeDTO } | null;

type RecurringChargeFormDialogProps = {
  projectId: string;
  currencies: readonly CurrencyOption[];
  defaultCurrency: string;
  target: RecurringChargeFormTarget;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

type FormValues = {
  label: string;
  amount: string;
  currency: string;
  frequency: (typeof FREQUENCY_VALUES)[number];
  startDate: DateOnly;
  endDate: DateOnly;
  billingDay: string;
  leadDays: string;
};

const FIELDS = [
  "label",
  "amount",
  "currency",
  "frequency",
  "startDate",
  "endDate",
  "billingDay",
  "leadDays",
] as const;
const DEFAULT_LEAD_DAYS = "7";

function RecurringChargeForm({
  projectId,
  currencies,
  defaultCurrency,
  target,
  onOpenChange,
  onSaved,
}: RecurringChargeFormDialogProps) {
  const t = useTranslations("billing.recurringForm");
  const tBilling = useTranslations("billing");
  const tEnums = useTranslations("enums");
  const tActions = useTranslations("common.actions");
  const tRoot = useTranslations();
  const router = useRouter();
  const charge = target?.mode === "edit" ? target.charge : null;

  const form = useForm<FormValues>({
    defaultValues: charge
      ? {
          label: charge.label,
          amount: charge.amount,
          currency: charge.currency,
          frequency: charge.frequency,
          startDate: charge.startDate,
          endDate: charge.endDate ?? "",
          billingDay: String(charge.billingDay),
          leadDays: String(charge.leadDays),
        }
      : {
          label: "",
          amount: "",
          currency: defaultCurrency,
          frequency: "MENSUAL",
          startDate: "",
          endDate: "",
          billingDay: "5",
          leadDays: DEFAULT_LEAD_DAYS,
        },
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormValues) {
    const fields = {
      label: values.label.trim(),
      amount: values.amount.trim(),
      currency: values.currency,
      frequency: values.frequency,
      startDate: values.startDate,
      endDate: orUndefined(values.endDate),
      billingDay: Number(values.billingDay),
      leadDays: Number(values.leadDays),
    };
    const result = charge
      ? await updateRecurringChargeAction({ id: charge.id, ...fields })
      : await createRecurringChargeAction({ projectId, ...fields });
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tRoot(result.error.message as never));
      return;
    }
    toast.success(charge ? tBilling("toast.chargeUpdated") : tBilling("toast.chargeCreated"));
    onSaved();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{charge ? t("editTitle") : t("createTitle")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.label ? true : undefined}>
        <FieldLabel htmlFor="charge-label">{t("fields.label")}</FieldLabel>
        <Input
          id="charge-label"
          aria-invalid={errors.label ? true : undefined}
          {...form.register("label", { required: true })}
        />
        <FieldError>{message(errors.label?.message)}</FieldError>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.amount ? true : undefined}>
          <FieldLabel htmlFor="charge-amount">{t("fields.amount")}</FieldLabel>
          <Input
            id="charge-amount"
            inputMode="decimal"
            className="tabular-nums"
            aria-describedby="charge-amount-hint"
            aria-invalid={errors.amount ? true : undefined}
            {...form.register("amount", { required: true })}
          />
          <FieldDescription id="charge-amount-hint">{t("amountHint")}</FieldDescription>
          <FieldError>{message(errors.amount?.message)}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="charge-currency">{t("fields.currency")}</FieldLabel>
          <Controller
            control={form.control}
            name="currency"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="charge-currency" className="w-full">
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
      </div>

      <Field>
        <FieldLabel htmlFor="charge-frequency">{t("fields.frequency")}</FieldLabel>
        <Controller
          control={form.control}
          name="frequency"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="charge-frequency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCY_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tEnums(`Frequency.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.startDate ? true : undefined}>
          <FieldLabel htmlFor="charge-start">{t("fields.startDate")}</FieldLabel>
          <Controller
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <DateField id="charge-start" value={field.value} onChange={field.onChange} />
            )}
          />
          <FieldError>{message(errors.startDate?.message)}</FieldError>
        </Field>

        <Field data-invalid={errors.endDate ? true : undefined}>
          <FieldLabel htmlFor="charge-end">{t("fields.endDate")}</FieldLabel>
          <Controller
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <DateField id="charge-end" value={field.value} onChange={field.onChange} />
            )}
          />
          <FieldError>{message(errors.endDate?.message)}</FieldError>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.billingDay ? true : undefined}>
          <FieldLabel htmlFor="charge-billing-day">{t("fields.billingDay")}</FieldLabel>
          <Input
            id="charge-billing-day"
            inputMode="numeric"
            aria-describedby="charge-billing-day-hint"
            aria-invalid={errors.billingDay ? true : undefined}
            {...form.register("billingDay", { required: true })}
          />
          <FieldDescription id="charge-billing-day-hint">{t("billingDayHint")}</FieldDescription>
          <FieldError>{message(errors.billingDay?.message)}</FieldError>
        </Field>

        <Field data-invalid={errors.leadDays ? true : undefined}>
          <FieldLabel htmlFor="charge-lead-days">{t("fields.leadDays")}</FieldLabel>
          <Input
            id="charge-lead-days"
            inputMode="numeric"
            aria-describedby="charge-lead-days-hint"
            aria-invalid={errors.leadDays ? true : undefined}
            {...form.register("leadDays", { required: true })}
          />
          <FieldDescription id="charge-lead-days-hint">{t("leadDaysHint")}</FieldDescription>
          <FieldError>{message(errors.leadDays?.message)}</FieldError>
        </Field>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={form.formState.isSubmitting}
        >
          {tActions("cancel")}
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {charge ? tActions("save") : t("create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create and edit dialog of a recurring charge. Changing the amount affects only the periods not generated yet.
export function RecurringChargeFormDialog(props: RecurringChargeFormDialogProps) {
  const { target, onOpenChange } = props;
  const key = target?.mode === "edit" ? `edit-${target.charge.id}` : (target?.mode ?? "closed");
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {target ? <RecurringChargeForm key={key} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}
