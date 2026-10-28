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
import { createMovementAction } from "@/features/accounts/actions";
import { lookupRateAction } from "@/features/catalogs/actions";
import { createMovementInputSchema, type CreateMovementInput } from "@/lib/validators/accounts";
import { ACCOUNT_MOVEMENT_TYPE_VALUES } from "@/lib/validators/enums";

const FORM_ID = "movement-form";
const FIELD_NAMES = [
  "accountId",
  "type",
  "date",
  "amount",
  "usdRate",
  "partnerId",
  "description",
] as const;

export type MovementFormAccount = { id: string; name: string; currency: string };
export type MovementFormPartner = { id: string; name: string };

type MovementFormProps = {
  accounts: MovementFormAccount[];
  partners: MovementFormPartner[];
  /** Business "today" (America/Caracas), computed on the server. */
  today: string;
  /** Prefill from the reconciliation (`?accountId=&type=AJUSTE&amount=&date=`). */
  initial?: {
    accountId?: string;
    type?: CreateMovementInput["type"];
    amount?: string;
    date?: string;
  };
};

/**
 * Manual movement of an account (PRD §8.7): a capital contribution, a partner withdrawal (both positive amounts,
 * the balance applies the sign) or a signed `AJUSTE`. Contributions and withdrawals name the partner; the
 * `AJUSTE` the reconciliation suggests is recorded here.
 */
export function MovementForm({ accounts, partners, today, initial }: MovementFormProps) {
  const t = useTranslations("accounts");
  const tRoot = useTranslations();
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const form = useForm<CreateMovementInput>({
    resolver: zodResolver(createMovementInputSchema) as never,
    defaultValues: {
      accountId: initial?.accountId ?? accounts[0]?.id ?? "",
      type: initial?.type ?? "APORTE_CAPITAL",
      date: initial?.date ?? today,
      amount: initial?.amount ?? "",
      usdRate: "",
      partnerId: undefined,
      description: "",
    },
  });

  const errors = form.formState.errors;
  const accountId = useWatch({ control: form.control, name: "accountId" });
  const type = useWatch({ control: form.control, name: "type" });
  const date = useWatch({ control: form.control, name: "date" });
  const account = accounts.find((item) => item.id === accountId);
  const isAdjustment = type === "AJUSTE";
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;

  async function lookupRate(
    lookupDate: string,
    currency: string,
  ): Promise<RateLookupResult | null> {
    const result = await lookupRateAction({ date: lookupDate, currency });
    return result.ok && result.data ? (result.data as RateLookupResult) : null;
  }

  async function onSubmit(values: CreateMovementInput) {
    setSaving(true);
    // An empty partner select is "no partner"; the schema only accepts an id or nothing.
    const result = await createMovementAction({ ...values, partnerId: values.partnerId || null });
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

    toast.success(t("toast.movementRecorded"));
    form.reset(form.getValues());
    router.push(`/accounts/${result.data.account.id}`);
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormPage
        title={t("movement.title")}
        description={t("movement.description")}
        backHref="/accounts"
        dirty={form.formState.isDirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href="/accounts">{tActions("cancel")}</Link>
            </Button>
            <Button type="submit" form={FORM_ID} disabled={saving}>
              {t("movement.submit")}
            </Button>
          </>
        }
      >
        <SectionCard
          group
          span={1}
          title={t("movement.sections.movement.title")}
          description={t("movement.sections.movement.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.type ? true : undefined}>
              <FieldLabel htmlFor="movement-type">{t("movement.fields.type")}</FieldLabel>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="movement-type"
                      className="w-full"
                      aria-invalid={errors.type ? true : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_MOVEMENT_TYPE_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {tEnums(`AccountMovementType.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>
                {isAdjustment ? t("movement.fields.adjustmentHint") : t("movement.fields.typeHint")}
              </FieldDescription>
              <FieldError>{fieldMessage(errors.type?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.accountId ? true : undefined}>
              <FieldLabel htmlFor="movement-account">{t("movement.fields.account")}</FieldLabel>
              <Controller
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="movement-account"
                      className="w-full"
                      aria-invalid={errors.accountId ? true : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {`${item.name} (${item.currency})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{fieldMessage(errors.accountId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.date ? true : undefined}>
              <FieldLabel htmlFor="movement-date">{t("movement.fields.date")}</FieldLabel>
              <Controller
                control={form.control}
                name="date"
                render={({ field }) => (
                  <DateField
                    id="movement-date"
                    value={field.value}
                    max={today}
                    onChange={field.onChange}
                  />
                )}
              />
              <FieldError>{fieldMessage(errors.date?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.amount ? true : undefined}>
              <FieldLabel htmlFor="movement-amount">
                {t("movement.fields.amount", { currency: account?.currency ?? "" })}
              </FieldLabel>
              <Input id="movement-amount" inputMode="decimal" {...form.register("amount")} />
              <FieldDescription>
                {isAdjustment
                  ? t("movement.fields.amountSignedHint")
                  : t("movement.fields.amountHint")}
              </FieldDescription>
              <FieldError>{fieldMessage(errors.amount?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.usdRate ? true : undefined}>
              <FieldLabel htmlFor="movement-usd-rate">
                {t("movement.fields.usdRate", { currency: account?.currency ?? "" })}
              </FieldLabel>
              {account ? (
                <Controller
                  control={form.control}
                  name="usdRate"
                  render={({ field }) => (
                    <RateInput
                      id="movement-usd-rate"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      date={date}
                      currency={account.currency}
                      lookupRate={lookupRate}
                    />
                  )}
                />
              ) : (
                <FieldDescription>{t("movement.fields.usdRatePending")}</FieldDescription>
              )}
              <FieldError>{fieldMessage(errors.usdRate?.message)}</FieldError>
            </Field>
            {isAdjustment ? null : (
              <Field data-invalid={errors.partnerId ? true : undefined}>
                <FieldLabel htmlFor="movement-partner">{t("movement.fields.partner")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="partnerId"
                  render={({ field }) => (
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="movement-partner"
                        className="w-full"
                        aria-invalid={errors.partnerId ? true : undefined}
                      >
                        <SelectValue placeholder={t("movement.fields.partnerPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {partners.map((partner) => (
                          <SelectItem key={partner.id} value={partner.id}>
                            {partner.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{fieldMessage(errors.partnerId?.message)}</FieldError>
              </Field>
            )}
            <Field data-invalid={errors.description ? true : undefined}>
              <FieldLabel htmlFor="movement-description">
                {t("movement.fields.description")}
              </FieldLabel>
              <Input id="movement-description" {...form.register("description")} />
              <FieldError>{fieldMessage(errors.description?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>
      </FormPage>
    </form>
  );
}
