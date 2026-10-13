"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm, type Path } from "react-hook-form";
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
import { createPaymentMethodInputSchema, type PaymentMethodDTO } from "@/lib/validators/catalogs";
import { z } from "@/lib/validators/zod";
import { createPaymentMethodAction, updatePaymentMethodAction } from "../actions";
import { applyFieldErrors } from "./form-errors";

export type PaymentMethodFormTarget =
  { mode: "create" } | { mode: "edit"; method: PaymentMethodDTO } | null;

type FormValues = z.input<typeof createPaymentMethodInputSchema>;
type FormOutput = z.output<typeof createPaymentMethodInputSchema>;

type PaymentMethodFormDialogProps = {
  target: PaymentMethodFormTarget;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const FIELDS = ["code", "name", "nameEn"] as const;
const SWITCHES = ["requiresReference", "suggestsIgtf", "active"] as const;

function PaymentMethodForm({ target, onOpenChange, onSaved }: PaymentMethodFormDialogProps) {
  const t = useTranslations("catalogs.paymentMethods");
  const tRoot = useTranslations();
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("common.errors");
  const method = target?.mode === "edit" ? target.method : null;

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(createPaymentMethodInputSchema),
    defaultValues: method
      ? {
          code: method.code,
          name: method.name,
          nameEn: method.nameEn ?? "",
          requiresReference: method.requiresReference,
          suggestsIgtf: method.suggestsIgtf,
          active: method.active,
        }
      : {
          code: "",
          name: "",
          nameEn: "",
          requiresReference: true,
          suggestsIgtf: false,
          active: true,
        },
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormOutput) {
    const { code, ...fields } = values;
    const result = method
      ? await updatePaymentMethodAction({ ...fields, id: method.id })
      : await createPaymentMethodAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tErrors(result.error.code));
      return;
    }
    void code;
    toast.success(method ? t("toast.updated") : t("toast.created"));
    onSaved();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{method ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
        <DialogDescription>{t("form.description")}</DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="method-name">{t("form.fields.name")}</FieldLabel>
        <Input
          id="method-name"
          aria-invalid={errors.name ? true : undefined}
          {...form.register("name")}
        />
        <FieldError>{message(errors.name?.message)}</FieldError>
      </Field>

      <Field>
        <FieldLabel htmlFor="method-name-en">{t("form.fields.nameEn")}</FieldLabel>
        <Input
          id="method-name-en"
          aria-describedby="method-name-en-hint"
          {...form.register("nameEn")}
        />
        <FieldDescription id="method-name-en-hint">{t("form.fields.nameEnHint")}</FieldDescription>
      </Field>

      <Controller
        control={form.control}
        name="code"
        render={({ field }) => (
          <Field data-invalid={errors.code ? true : undefined}>
            <FieldLabel htmlFor="method-code">{t("form.fields.code")}</FieldLabel>
            <Input
              id="method-code"
              className="font-mono"
              readOnly={method !== null}
              aria-describedby="method-code-hint"
              aria-invalid={errors.code ? true : undefined}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value.trim().toUpperCase())}
              onBlur={field.onBlur}
            />
            <FieldDescription id="method-code-hint">{t("form.fields.codeHint")}</FieldDescription>
            <FieldError>{message(errors.code?.message)}</FieldError>
          </Field>
        )}
      />

      {SWITCHES.map((name) => (
        <Controller
          key={name}
          control={form.control}
          name={name as Path<FormValues>}
          render={({ field }) => (
            <Field orientation="horizontal">
              <FieldLabel htmlFor={`method-${name}`}>{t(`form.fields.${name}`)}</FieldLabel>
              <Switch
                id={`method-${name}`}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
                aria-describedby={name === "suggestsIgtf" ? "method-igtf-hint" : undefined}
              />
            </Field>
          )}
        />
      ))}
      <FieldDescription id="method-igtf-hint" className="-mt-2">
        {t("form.fields.suggestsIgtfHint")}
      </FieldDescription>

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
          {method ? tActions("save") : t("form.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create and edit dialog of a payment method. The code is the stable identifier: typed on create, read-only on edit.
export function PaymentMethodFormDialog(props: PaymentMethodFormDialogProps) {
  const { target, onOpenChange } = props;
  const key = target?.mode === "edit" ? `edit-${target.method.id}` : (target?.mode ?? "closed");
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>{target ? <PaymentMethodForm key={key} {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
