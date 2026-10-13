"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createCurrencyInputSchema, type CurrencyDTO } from "@/lib/validators/catalogs";
import { z } from "@/lib/validators/zod";
import { createCurrencyAction, updateCurrencyAction } from "../actions";
import { applyFieldErrors } from "./form-errors";

export type CurrencyFormTarget =
  { mode: "create" } | { mode: "edit"; currency: CurrencyDTO } | null;

type FormValues = z.input<typeof createCurrencyInputSchema>;
type FormOutput = z.output<typeof createCurrencyInputSchema>;

type CurrencyFormDialogProps = {
  target: CurrencyFormTarget;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const FIELDS = ["code", "name", "symbol", "decimals", "active"] as const;

function CurrencyForm({ target, onOpenChange, onSaved }: CurrencyFormDialogProps) {
  const t = useTranslations("catalogs.currencies");
  const tRoot = useTranslations();
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("common.errors");
  const currency = target?.mode === "edit" ? target.currency : null;

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(createCurrencyInputSchema),
    defaultValues: currency ?? { code: "", name: "", symbol: "", decimals: 2, active: true },
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormOutput) {
    const result = currency
      ? await updateCurrencyAction({ ...values, code: currency.code })
      : await createCurrencyAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(currency ? t("toast.updated") : t("toast.created"));
    onSaved();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{currency ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
        <DialogDescription>{t("form.description")}</DialogDescription>
      </DialogHeader>

      <Controller
        control={form.control}
        name="code"
        render={({ field }) => (
          <Field data-invalid={errors.code ? true : undefined}>
            <FieldLabel htmlFor="currency-code">{t("form.fields.code")}</FieldLabel>
            <Input
              id="currency-code"
              className="font-mono uppercase"
              readOnly={currency !== null}
              aria-describedby="currency-code-hint"
              aria-invalid={errors.code ? true : undefined}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value.trim().toUpperCase())}
              onBlur={field.onBlur}
            />
            <FieldDescription id="currency-code-hint">{t("form.fields.codeHint")}</FieldDescription>
            <FieldError>{message(errors.code?.message)}</FieldError>
          </Field>
        )}
      />

      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="currency-name">{t("form.fields.name")}</FieldLabel>
        <Input
          id="currency-name"
          aria-invalid={errors.name ? true : undefined}
          {...form.register("name")}
        />
        <FieldError>{message(errors.name?.message)}</FieldError>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field data-invalid={errors.symbol ? true : undefined}>
          <FieldLabel htmlFor="currency-symbol">{t("form.fields.symbol")}</FieldLabel>
          <Input
            id="currency-symbol"
            aria-invalid={errors.symbol ? true : undefined}
            {...form.register("symbol")}
          />
          <FieldError>{message(errors.symbol?.message)}</FieldError>
        </Field>
        <Field data-invalid={errors.decimals ? true : undefined}>
          <FieldLabel htmlFor="currency-decimals">{t("form.fields.decimals")}</FieldLabel>
          <Input
            id="currency-decimals"
            type="number"
            inputMode="numeric"
            min={0}
            max={8}
            aria-invalid={errors.decimals ? true : undefined}
            {...form.register("decimals", { valueAsNumber: true })}
          />
          <FieldError>{message(errors.decimals?.message)}</FieldError>
        </Field>
      </div>

      <Controller
        control={form.control}
        name="active"
        render={({ field }) => (
          <Field orientation="horizontal" data-invalid={errors.active ? true : undefined}>
            <FieldLabel htmlFor="currency-active">{t("form.fields.active")}</FieldLabel>
            <Switch
              id="currency-active"
              checked={field.value ?? true}
              onCheckedChange={field.onChange}
            />
            <FieldError>{message(errors.active?.message)}</FieldError>
          </Field>
        )}
      />

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
          {currency ? tActions("save") : t("form.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create and edit dialog of a currency. The code is the key: typed on create, read-only on edit.
export function CurrencyFormDialog(props: CurrencyFormDialogProps) {
  const { target, onOpenChange } = props;
  const key = target?.mode === "edit" ? `edit-${target.currency.code}` : (target?.mode ?? "closed");
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>{target ? <CurrencyForm key={key} {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
