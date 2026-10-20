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
import type { InstallmentDTO } from "@/lib/validators/billing";
import { INSTALLMENT_KIND_VALUES } from "@/lib/validators/enums";
import type { DateOnly } from "@/lib/dates";
import { createInstallmentAction, updateInstallmentAction } from "../actions";
import { applyFieldErrors, orUndefined } from "./form-errors";

/** Kinds a person creates by hand: `RECURRENTE` comes from a recurring charge only (PRD §8.4.2). */
const MANUAL_KINDS = INSTALLMENT_KIND_VALUES.filter((kind) => kind !== "RECURRENTE");

export type InstallmentFormTarget =
  { mode: "create" } | { mode: "edit"; installment: InstallmentDTO } | null;

export interface CurrencyOption {
  code: string;
  name: string;
}

type InstallmentFormDialogProps = {
  projectId: string;
  currencies: readonly CurrencyOption[];
  /** Currency of the plan: the default of a new installment. */
  defaultCurrency: string;
  target: InstallmentFormTarget;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

type FormValues = {
  label: string;
  kind: (typeof MANUAL_KINDS)[number];
  amount: string;
  currency: string;
  percentage: string;
  dueDate: DateOnly;
  trigger: string;
};

const FIELDS = ["label", "kind", "amount", "currency", "percentage", "dueDate", "trigger"] as const;

function InstallmentForm({
  projectId,
  currencies,
  defaultCurrency,
  target,
  onOpenChange,
  onSaved,
}: InstallmentFormDialogProps) {
  const t = useTranslations("billing.installmentForm");
  const tBilling = useTranslations("billing");
  const tEnums = useTranslations("enums");
  const tActions = useTranslations("common.actions");
  const tRoot = useTranslations();
  const router = useRouter();
  const installment = target?.mode === "edit" ? target.installment : null;
  const locked = installment?.locked ?? false;

  const form = useForm<FormValues>({
    defaultValues: installment
      ? {
          label: installment.label,
          kind: MANUAL_KINDS.includes(installment.kind as (typeof MANUAL_KINDS)[number])
            ? (installment.kind as (typeof MANUAL_KINDS)[number])
            : "CUOTA",
          amount: installment.amount,
          currency: installment.currency,
          percentage: installment.percentage ?? "",
          dueDate: installment.dueDate ?? "",
          trigger: installment.trigger ?? "",
        }
      : {
          label: "",
          kind: "CUOTA",
          amount: "",
          currency: defaultCurrency,
          percentage: "",
          dueDate: "",
          trigger: "",
        },
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormValues) {
    const shared = {
      label: values.label.trim(),
      amount: values.amount.trim(),
      currency: values.currency,
      percentage: orUndefined(values.percentage),
      dueDate: orUndefined(values.dueDate),
      trigger: orUndefined(values.trigger),
    };
    // A billed installment only accepts a new label (the service refuses any other change).
    const result = installment
      ? await updateInstallmentAction(
          locked ? { id: installment.id, label: shared.label } : { id: installment.id, ...shared },
        )
      : await createInstallmentAction({ projectId, kind: values.kind, ...shared });
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tRoot(result.error.message as never));
      return;
    }
    toast.success(
      installment ? tBilling("toast.installmentUpdated") : tBilling("toast.installmentCreated"),
    );
    onSaved();
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{installment ? t("editTitle") : t("createTitle")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.label ? true : undefined}>
        <FieldLabel htmlFor="installment-label">{t("fields.label")}</FieldLabel>
        <Input
          id="installment-label"
          aria-invalid={errors.label ? true : undefined}
          {...form.register("label", { required: true })}
        />
        <FieldError>{message(errors.label?.message)}</FieldError>
      </Field>
      {locked ? (
        <FieldDescription id="installment-locked-hint">{t("lockedHint")}</FieldDescription>
      ) : null}

      {installment ? null : (
        <Field data-invalid={errors.kind ? true : undefined}>
          <FieldLabel htmlFor="installment-kind">{t("fields.kind")}</FieldLabel>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="installment-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {tEnums(`InstallmentKind.${kind}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.amount ? true : undefined}>
          <FieldLabel htmlFor="installment-amount">{t("fields.amount")}</FieldLabel>
          <Input
            id="installment-amount"
            inputMode="decimal"
            className="tabular-nums"
            disabled={locked}
            aria-describedby={locked ? "installment-locked-hint" : undefined}
            aria-invalid={errors.amount ? true : undefined}
            {...form.register("amount", { required: true })}
          />
          <FieldError>{message(errors.amount?.message)}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="installment-currency">{t("fields.currency")}</FieldLabel>
          <Controller
            control={form.control}
            name="currency"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={locked}>
                <SelectTrigger id="installment-currency" className="w-full">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.percentage ? true : undefined}>
          <FieldLabel htmlFor="installment-percentage">{t("fields.percentage")}</FieldLabel>
          <Input
            id="installment-percentage"
            inputMode="decimal"
            disabled={locked}
            aria-describedby={locked ? "installment-locked-hint" : undefined}
            aria-invalid={errors.percentage ? true : undefined}
            {...form.register("percentage")}
          />
          <FieldError>{message(errors.percentage?.message)}</FieldError>
        </Field>

        <Field data-invalid={errors.dueDate ? true : undefined}>
          <FieldLabel htmlFor="installment-due">{t("fields.dueDate")}</FieldLabel>
          <Controller
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <DateField
                id="installment-due"
                value={field.value}
                onChange={field.onChange}
                disabled={locked}
              />
            )}
          />
          <FieldError>{message(errors.dueDate?.message)}</FieldError>
        </Field>
      </div>

      <Field data-invalid={errors.trigger ? true : undefined}>
        <FieldLabel htmlFor="installment-trigger">{t("fields.trigger")}</FieldLabel>
        <Input
          id="installment-trigger"
          disabled={locked}
          aria-describedby="installment-trigger-hint"
          aria-invalid={errors.trigger ? true : undefined}
          {...form.register("trigger")}
        />
        <FieldDescription id="installment-trigger-hint">{t("triggerHint")}</FieldDescription>
        <FieldError>{message(errors.trigger?.message)}</FieldError>
      </Field>

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
          {installment ? tActions("save") : t("create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create and edit dialog of an installment. A billed installment keeps its amount and currency (HU-09 CA3).
export function InstallmentFormDialog(props: InstallmentFormDialogProps) {
  const { target, onOpenChange } = props;
  const key =
    target?.mode === "edit" ? `edit-${target.installment.id}` : (target?.mode ?? "closed");
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {target ? <InstallmentForm key={key} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}
