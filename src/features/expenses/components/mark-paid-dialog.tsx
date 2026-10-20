"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
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
import { DateField } from "@/components/ui/date-field/date-field";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RateInput, type RateLookupResult } from "@/components/ui/rate-input/rate-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lookupRateAction } from "@/features/catalogs/actions";
import { markExpensePaidAction } from "@/features/expenses/actions";
import type { ExpenseAccountOption } from "@/features/expenses/form-options";
import { applyFieldErrors, asSchemaValue } from "@/features/expenses/components/form-utils";
import { markExpensePaidInputSchema, type ExpenseDetailDTO } from "@/lib/validators/expenses";

const FORM_ID = "mark-paid-form";
const NONE = "__none__";
const FIELDS = ["accountId", "paidAt", "currency", "amount", "usdRate", "accountAmount"] as const;

type FormValues = {
  id: string;
  accountId: string;
  paidAt: string;
  currency: string;
  amount: string;
  usdRate: string;
  accountAmount: string;
};

type MarkPaidInput = Parameters<typeof markExpensePaidAction>[0];

/** The payload of "Marcar como pagado": the expense keeps its currency; the rate is `1` in USD (§9.2). */
function toMarkPaidInput(
  values: FormValues,
  accounts: ExpenseAccountOption[],
  currency: string,
): MarkPaidInput {
  const raw = asSchemaValue(values, NONE);
  const account = accounts.find((item) => item.id === values.accountId);
  const debit = account !== undefined && account.currency !== currency;
  return {
    id: values.id,
    accountId: raw.accountId ?? "",
    paidAt: values.paidAt,
    currency,
    amount: values.amount.trim(),
    usdRate: currency === "USD" ? "1" : (raw.usdRate ?? ""),
    accountAmount: debit ? raw.accountAmount : undefined,
  };
}

type MarkPaidDialogProps = {
  expense: ExpenseDetailDTO;
  accounts: ExpenseAccountOption[];
  /** Business "today" (America/Caracas), computed on the server. */
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * "Marcar como pagado" (HU-17 CA2, PRD §8.8): the payment account is required, and the real amount and the rate
 * can be adjusted from the estimate. A debit in another currency than the account asks for `accountAmount` (§9.7).
 */
export function MarkPaidDialog({
  expense,
  accounts,
  today,
  open,
  onOpenChange,
}: MarkPaidDialogProps) {
  const t = useTranslations("expenses");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const resolve = zodResolver(markExpensePaidInputSchema) as unknown as Resolver<FormValues>;
  const resolver: Resolver<FormValues> = (values, context, options) =>
    resolve(
      toMarkPaidInput(values, accounts, expense.currency) as unknown as FormValues,
      context,
      options,
    );

  const form = useForm<FormValues>({
    resolver,
    defaultValues: {
      id: expense.id,
      accountId: NONE,
      paidAt: today,
      currency: expense.currency,
      amount: expense.amount,
      usdRate: expense.usdRate,
      accountAmount: "",
    },
  });

  const errors = form.formState.errors;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;
  const accountId = useWatch({ control: form.control, name: "accountId" });
  const paidAt = useWatch({ control: form.control, name: "paidAt" });
  const account = accounts.find((item) => item.id === accountId);
  const needsDebit = account !== undefined && account.currency !== expense.currency;
  const needsRate = expense.currency !== "USD";

  async function lookupRate(
    lookupDate: string,
    currency: string,
  ): Promise<RateLookupResult | null> {
    const result = await lookupRateAction({ date: lookupDate, currency });
    return result.ok && result.data ? (result.data as RateLookupResult) : null;
  }

  async function onSubmit() {
    setSaving(true);
    const result = await markExpensePaidAction(
      toMarkPaidInput(form.getValues(), accounts, expense.currency),
    );
    setSaving(false);

    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(
        result.error.message ? tRoot(result.error.message as never) : tErrors(result.error.code),
      );
      return;
    }

    toast.success(t("toast.paid"));
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("markPaid.title")}</DialogTitle>
          <DialogDescription>{t("markPaid.description")}</DialogDescription>
        </DialogHeader>
        <form
          id={FORM_ID}
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <Field data-invalid={errors.accountId ? true : undefined}>
            <FieldLabel htmlFor="mark-paid-account">{t("markPaid.fields.account")}</FieldLabel>
            <Controller
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="mark-paid-account" className="w-full">
                    <SelectValue placeholder={t("markPaid.placeholders.account")} />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {`${item.name} · ${item.currency}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError>{fieldMessage(errors.accountId?.message)}</FieldError>
          </Field>
          <Field data-invalid={errors.paidAt ? true : undefined}>
            <FieldLabel htmlFor="mark-paid-date">{t("markPaid.fields.paidAt")}</FieldLabel>
            <Controller
              control={form.control}
              name="paidAt"
              render={({ field }) => (
                <DateField
                  id="mark-paid-date"
                  value={field.value}
                  max={today}
                  onChange={field.onChange}
                />
              )}
            />
            <FieldError>{fieldMessage(errors.paidAt?.message)}</FieldError>
          </Field>
          <Field data-invalid={errors.amount ? true : undefined}>
            <FieldLabel htmlFor="mark-paid-amount">
              {t("markPaid.fields.amount", { currency: expense.currency })}
            </FieldLabel>
            <Input id="mark-paid-amount" inputMode="decimal" {...form.register("amount")} />
            <FieldDescription>{t("markPaid.hints.amount")}</FieldDescription>
            <FieldError>{fieldMessage(errors.amount?.message)}</FieldError>
          </Field>
          {needsRate ? (
            <Field data-invalid={errors.usdRate ? true : undefined}>
              <FieldLabel htmlFor="mark-paid-rate">
                {t("markPaid.fields.usdRate", { currency: expense.currency })}
              </FieldLabel>
              <Controller
                control={form.control}
                name="usdRate"
                render={({ field }) => (
                  <RateInput
                    id="mark-paid-rate"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    date={paidAt}
                    currency={expense.currency}
                    lookupRate={lookupRate}
                  />
                )}
              />
              <FieldError>{fieldMessage(errors.usdRate?.message)}</FieldError>
            </Field>
          ) : null}
          {needsDebit ? (
            <Field data-invalid={errors.accountAmount ? true : undefined}>
              <FieldLabel htmlFor="mark-paid-account-amount">
                {t("markPaid.fields.accountAmount", { currency: account?.currency ?? "" })}
              </FieldLabel>
              <Input
                id="mark-paid-account-amount"
                inputMode="decimal"
                {...form.register("accountAmount")}
              />
              <FieldDescription>{t("markPaid.hints.accountAmount")}</FieldDescription>
              <FieldError>{fieldMessage(errors.accountAmount?.message)}</FieldError>
            </Field>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tActions("cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={saving || accounts.length === 0}>
            {t("markPaid.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
