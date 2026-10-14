"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
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
import { createTransferAction } from "@/features/accounts/actions";
import { lookupRateAction } from "@/features/catalogs/actions";
import { createTransferInputSchema, type CreateTransferInput } from "@/lib/validators/accounts";

const FORM_ID = "transfer-form";
const FIELD_NAMES = [
  "date",
  "fromAccountId",
  "toAccountId",
  "amountFrom",
  "amountTo",
  "feeAmount",
  "rate",
  "usdRate",
  "reference",
  "notes",
] as const;

export type TransferFormAccount = { id: string; name: string; currency: string };

type TransferFormProps = {
  /** Active accounts: a transfer needs an active origin and destination. */
  accounts: TransferFormAccount[];
  /** Business "today" (America/Caracas), computed on the server. */
  today: string;
  /** Preselected origin (`?from=`), when the transfer starts from an account. */
  initialFromAccountId?: string;
};

/**
 * Transfer between two accounts (HU-16). The origin is debited by the amount plus the fee; the destination is
 * credited with the amount it receives, in its own currency (CA1). An account cannot transfer to itself (CA2),
 * and the schema rejects it before the call.
 */
export function TransferForm({ accounts, today, initialFromAccountId }: TransferFormProps) {
  const t = useTranslations("accounts");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const form = useForm<CreateTransferInput>({
    resolver: zodResolver(createTransferInputSchema) as never,
    defaultValues: {
      date: today,
      fromAccountId: initialFromAccountId ?? accounts[0]?.id ?? "",
      toAccountId: accounts[1]?.id ?? accounts[0]?.id ?? "",
      amountFrom: "",
      amountTo: "",
      feeAmount: "0",
      rate: undefined,
      usdRate: "",
      reference: "",
      notes: "",
    },
  });

  const errors = form.formState.errors;
  const fromId = useWatch({ control: form.control, name: "fromAccountId" });
  const toId = useWatch({ control: form.control, name: "toAccountId" });
  const date = useWatch({ control: form.control, name: "date" });
  const fromAccount = accounts.find((account) => account.id === fromId);
  const toAccount = accounts.find((account) => account.id === toId);
  const crossCurrency =
    fromAccount !== undefined &&
    toAccount !== undefined &&
    fromAccount.currency !== toAccount.currency;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;

  async function lookupRate(
    lookupDate: string,
    currency: string,
  ): Promise<RateLookupResult | null> {
    const result = await lookupRateAction({ date: lookupDate, currency });
    return result.ok && result.data ? (result.data as RateLookupResult) : null;
  }

  async function onSubmit(values: CreateTransferInput) {
    setSaving(true);
    const result = await createTransferAction(values);
    setSaving(false);

    if (!result.ok) {
      const { error } = result;
      if (error.fieldErrors) {
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const message = messages[0];
          if (message && (FIELD_NAMES as readonly string[]).includes(field)) {
            form.setError(field as (typeof FIELD_NAMES)[number], {
              message: tRoot(message as never),
            });
          }
        }
      }
      toast.error(tErrors(error.code));
      return;
    }

    toast.success(t("toast.transferred"));
    form.reset(form.getValues());
    router.push(`/accounts/${result.data.fromAccount.id}`);
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormPage
        title={t("transfer.title")}
        description={t("transfer.description")}
        backHref="/accounts"
        dirty={form.formState.isDirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href="/accounts">{tActions("cancel")}</Link>
            </Button>
            <Button type="submit" form={FORM_ID} disabled={saving}>
              {t("transfer.submit")}
            </Button>
          </>
        }
      >
        <SectionCard
          group
          span={1}
          title={t("transfer.sections.route.title")}
          description={t("transfer.sections.route.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.date ? true : undefined}>
              <FieldLabel htmlFor="transfer-date">{t("transfer.fields.date")}</FieldLabel>
              <Controller
                control={form.control}
                name="date"
                render={({ field }) => (
                  <DateField
                    id="transfer-date"
                    value={field.value}
                    max={today}
                    onChange={field.onChange}
                  />
                )}
              />
              <FieldError>{fieldMessage(errors.date?.message)}</FieldError>
            </Field>
            <div aria-hidden className="hidden @lg:block" />
            <Field data-invalid={errors.fromAccountId ? true : undefined}>
              <FieldLabel htmlFor="transfer-from">{t("transfer.fields.from")}</FieldLabel>
              <Controller
                control={form.control}
                name="fromAccountId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="transfer-from"
                      className="w-full"
                      aria-invalid={errors.fromAccountId ? true : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {`${account.name} (${account.currency})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{fieldMessage(errors.fromAccountId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.toAccountId ? true : undefined}>
              <FieldLabel htmlFor="transfer-to">{t("transfer.fields.to")}</FieldLabel>
              <Controller
                control={form.control}
                name="toAccountId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="transfer-to"
                      className="w-full"
                      aria-invalid={errors.toAccountId ? true : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {`${account.name} (${account.currency})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{fieldMessage(errors.toAccountId?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("transfer.sections.amounts.title")}
          description={t("transfer.sections.amounts.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.amountFrom ? true : undefined}>
              <FieldLabel htmlFor="transfer-amount-from">
                {t("transfer.fields.amountFrom", { currency: fromAccount?.currency ?? "" })}
              </FieldLabel>
              <Input
                id="transfer-amount-from"
                inputMode="decimal"
                {...form.register("amountFrom")}
              />
              <FieldError>{fieldMessage(errors.amountFrom?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.amountTo ? true : undefined}>
              <FieldLabel htmlFor="transfer-amount-to">
                {t("transfer.fields.amountTo", { currency: toAccount?.currency ?? "" })}
              </FieldLabel>
              <Input id="transfer-amount-to" inputMode="decimal" {...form.register("amountTo")} />
              <FieldDescription>{t("transfer.fields.amountToHint")}</FieldDescription>
              <FieldError>{fieldMessage(errors.amountTo?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.feeAmount ? true : undefined}>
              <FieldLabel htmlFor="transfer-fee">
                {t("transfer.fields.fee", { currency: fromAccount?.currency ?? "" })}
              </FieldLabel>
              <Input id="transfer-fee" inputMode="decimal" {...form.register("feeAmount")} />
              <FieldError>{fieldMessage(errors.feeAmount?.message)}</FieldError>
            </Field>
            {crossCurrency ? (
              <Field data-invalid={errors.rate ? true : undefined}>
                <FieldLabel htmlFor="transfer-rate">{t("transfer.fields.rate")}</FieldLabel>
                <Input id="transfer-rate" inputMode="decimal" {...form.register("rate")} />
                <FieldDescription>{t("transfer.fields.rateHint")}</FieldDescription>
                <FieldError>{fieldMessage(errors.rate?.message)}</FieldError>
              </Field>
            ) : null}
            <Field data-invalid={errors.usdRate ? true : undefined}>
              <FieldLabel htmlFor="transfer-usd-rate">
                {t("transfer.fields.usdRate", { currency: fromAccount?.currency ?? "" })}
              </FieldLabel>
              {fromAccount ? (
                <Controller
                  control={form.control}
                  name="usdRate"
                  render={({ field }) => (
                    <RateInput
                      id="transfer-usd-rate"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      date={date}
                      currency={fromAccount.currency}
                      lookupRate={lookupRate}
                    />
                  )}
                />
              ) : (
                <FieldDescription>{t("transfer.fields.usdRatePending")}</FieldDescription>
              )}
              <FieldError>{fieldMessage(errors.usdRate?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>

        <SectionCard group span={1} title={t("transfer.sections.reference.title")}>
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.reference ? true : undefined}>
              <FieldLabel htmlFor="transfer-reference">{t("transfer.fields.reference")}</FieldLabel>
              <Input id="transfer-reference" {...form.register("reference")} />
              <FieldError>{fieldMessage(errors.reference?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.notes ? true : undefined}>
              <FieldLabel htmlFor="transfer-notes">{t("transfer.fields.notes")}</FieldLabel>
              <Input id="transfer-notes" {...form.register("notes")} />
              <FieldError>{fieldMessage(errors.notes?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>
      </FormPage>
    </form>
  );
}
