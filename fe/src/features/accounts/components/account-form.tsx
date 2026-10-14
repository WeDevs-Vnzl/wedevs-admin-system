"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { SectionCard } from "@/components/patterns/section-card";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createAccountAction, updateAccountAction } from "@/features/accounts/actions";
import {
  createAccountInputSchema,
  updateAccountInputSchema,
  type AccountDTO,
  type CreateAccountInput,
} from "@/lib/validators/accounts";
import { ACCOUNT_TYPE_VALUES } from "@/lib/validators/enums";

const FORM_ID = "account-form";
const FIELD_NAMES = [
  "name",
  "type",
  "institution",
  "currency",
  "identifierMasked",
  "holderName",
  "openingBalance",
  "openingDate",
  "active",
  "notes",
] as const;

export type AccountFormCurrency = { code: string; name: string };

type AccountFormProps = {
  /** Present on `/accounts/[id]/edit`; absent on `/accounts/new`. */
  account?: AccountDTO;
  /** Active currencies of the catalog (Settings). */
  currencies: AccountFormCurrency[];
  /** The currency of an account with movements is fixed (its balance is in that currency). */
  currencyLocked?: boolean;
};

/**
 * Create and edit form of a company account (PRD §8.7). The schemas of the actions resolve the form, so a field
 * error shows before the call. The identifier is masked on parse: the full value never reaches the store (C5).
 * A blank identifier keeps the stored one when editing.
 */
export function AccountForm({ account, currencies, currencyLocked = false }: AccountFormProps) {
  const t = useTranslations("accounts");
  const tRoot = useTranslations();
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const form = useForm<CreateAccountInput>({
    resolver: zodResolver(account ? updateAccountInputSchema : createAccountInputSchema) as never,
    defaultValues: account
      ? {
          name: account.name,
          type: account.type,
          institution: account.institution ?? "",
          currency: account.currency,
          identifierMasked: "",
          holderName: account.holderName ?? "",
          openingBalance: account.openingBalance,
          openingDate: account.openingDate,
          active: account.active,
          notes: account.notes ?? "",
        }
      : {
          name: "",
          type: "BILLETERA_DIGITAL",
          institution: "",
          currency: "USD",
          identifierMasked: "",
          holderName: "",
          openingBalance: "0",
          openingDate: "",
          active: true,
          notes: "",
        },
  });

  const errors = form.formState.errors;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;

  async function onSubmit(values: CreateAccountInput) {
    setSaving(true);
    const result = account
      ? await updateAccountAction({ ...values, id: account.id })
      : await createAccountAction(values);
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

    toast.success(account ? t("toast.updated") : t("toast.created"));
    form.reset(form.getValues());
    router.push(`/accounts/${result.data.id}`);
  }

  const backHref = account ? `/accounts/${account.id}` : "/accounts/list";

  return (
    <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormPage
        title={account ? t("form.editTitle") : t("form.createTitle")}
        description={t("form.description")}
        backHref={backHref}
        dirty={form.formState.isDirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href={backHref}>{tActions("cancel")}</Link>
            </Button>
            <Button type="submit" form={FORM_ID} disabled={saving}>
              {tActions("save")}
            </Button>
          </>
        }
      >
        <SectionCard
          group
          span={1}
          title={t("form.sections.identity.title")}
          description={t("form.sections.identity.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="account-name">{t("form.fields.name")}</FieldLabel>
              <Input
                id="account-name"
                aria-invalid={errors.name ? true : undefined}
                {...form.register("name")}
              />
              <FieldError>{fieldMessage(errors.name?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.type ? true : undefined}>
              <FieldLabel htmlFor="account-type">{t("form.fields.type")}</FieldLabel>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="account-type"
                      className="w-full"
                      aria-invalid={errors.type ? true : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPE_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {tEnums(`AccountType.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{fieldMessage(errors.type?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.institution ? true : undefined}>
              <FieldLabel htmlFor="account-institution">{t("form.fields.institution")}</FieldLabel>
              <Input id="account-institution" {...form.register("institution")} />
              <FieldError>{fieldMessage(errors.institution?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.currency ? true : undefined}>
              <FieldLabel htmlFor="account-currency">{t("form.fields.currency")}</FieldLabel>
              <Controller
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={currencyLocked}
                  >
                    <SelectTrigger
                      id="account-currency"
                      className="w-full"
                      aria-invalid={errors.currency ? true : undefined}
                    >
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
              <FieldDescription>
                {currencyLocked
                  ? t("form.fields.currencyLockedHint")
                  : t("form.fields.currencyHint")}
              </FieldDescription>
              <FieldError>{fieldMessage(errors.currency?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.identifierMasked ? true : undefined}>
              <FieldLabel htmlFor="account-identifier">{t("form.fields.identifier")}</FieldLabel>
              <Input
                id="account-identifier"
                autoComplete="off"
                placeholder={account?.identifierMasked ?? t("form.fields.identifierPlaceholder")}
                {...form.register("identifierMasked")}
              />
              <FieldDescription>{t("form.fields.identifierHint")}</FieldDescription>
              <FieldError>{fieldMessage(errors.identifierMasked?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.holderName ? true : undefined}>
              <FieldLabel htmlFor="account-holder">{t("form.fields.holderName")}</FieldLabel>
              <Input id="account-holder" {...form.register("holderName")} />
              <FieldError>{fieldMessage(errors.holderName?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.opening.title")}
          description={t("form.sections.opening.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.openingBalance ? true : undefined}>
              <FieldLabel htmlFor="account-opening-balance">
                {t("form.fields.openingBalance")}
              </FieldLabel>
              <Input
                id="account-opening-balance"
                inputMode="decimal"
                aria-invalid={errors.openingBalance ? true : undefined}
                {...form.register("openingBalance")}
              />
              <FieldError>{fieldMessage(errors.openingBalance?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.openingDate ? true : undefined}>
              <FieldLabel htmlFor="account-opening-date">{t("form.fields.openingDate")}</FieldLabel>
              <Input id="account-opening-date" type="date" {...form.register("openingDate")} />
              <FieldError>{fieldMessage(errors.openingDate?.message)}</FieldError>
            </Field>
            {account ? (
              <Field>
                <FieldLabel htmlFor="account-active">{t("form.fields.active")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <Switch
                      id="account-active"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
                <FieldDescription>{t("form.fields.activeHint")}</FieldDescription>
              </Field>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard group span={1} title={t("form.sections.notes.title")}>
          <Field data-invalid={errors.notes ? true : undefined}>
            <FieldLabel htmlFor="account-notes">{t("form.fields.notes")}</FieldLabel>
            <Textarea id="account-notes" rows={3} {...form.register("notes")} />
            <FieldError>{fieldMessage(errors.notes?.message)}</FieldError>
          </Field>
        </SectionCard>
      </FormPage>
    </form>
  );
}
