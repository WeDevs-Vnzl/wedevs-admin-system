"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
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
import { lookupRateAction } from "@/features/catalogs/actions";
import { createExpenseAction } from "@/features/expenses/actions";
import type { ExpenseAccountOption, ExpenseFormOptions } from "@/features/expenses/form-options";
import { applyFieldErrors, asSchemaValue } from "@/features/expenses/components/form-utils";
import { createExpenseInputSchema, EXPENSE_CREATE_STATUS_VALUES } from "@/lib/validators/expenses";

const FORM_ID = "expense-form";
const NONE = "__none__";
const FIELDS = [
  "date",
  "dueDate",
  "description",
  "vendor",
  "categoryId",
  "status",
  "accountId",
  "projectId",
  "currency",
  "amount",
  "usdRate",
  "paidAt",
  "accountAmount",
] as const;

type FormValues = {
  date: string;
  dueDate: string;
  description: string;
  vendor: string;
  categoryId: string;
  status: (typeof EXPENSE_CREATE_STATUS_VALUES)[number];
  accountId: string;
  projectId: string;
  currency: string;
  amount: string;
  usdRate: string;
  paidAt: string;
  accountAmount: string;
};

type ExpenseInput = Parameters<typeof createExpenseAction>[0];

/**
 * The payload the action takes from the form values. The USD rate of a USD expense is `1`, and the debit in the
 * account currency is sent only when the account currency differs (§9.7).
 */
function toExpenseInput(values: FormValues, accounts: ExpenseAccountOption[]): ExpenseInput {
  const raw = asSchemaValue(values, NONE);
  const account = accounts.find((item) => item.id === values.accountId);
  const debit =
    values.status === "PAGADO" && account !== undefined && account.currency !== values.currency;
  return {
    date: values.date,
    dueDate: raw.dueDate,
    description: values.description,
    vendor: raw.vendor,
    categoryId: values.categoryId,
    status: values.status,
    accountId: raw.accountId,
    projectId: raw.projectId,
    currency: values.currency,
    amount: values.amount.trim(),
    usdRate: values.currency === "USD" ? "1" : (raw.usdRate ?? ""),
    paidAt: values.status === "PAGADO" ? raw.paidAt : undefined,
    accountAmount: debit ? raw.accountAmount : undefined,
  };
}

/** Validates what the form would send, with blank optional fields absent (see `asSchemaValue`). */
function expenseResolver(accounts: ExpenseAccountOption[]): Resolver<FormValues> {
  const resolve = zodResolver(createExpenseInputSchema) as unknown as Resolver<FormValues>;
  return (values, context, options) =>
    resolve(toExpenseInput(values, accounts) as unknown as FormValues, context, options);
}

type ExpenseFormProps = {
  options: ExpenseFormOptions;
  /** Business "today" (America/Caracas), computed on the server. */
  today: string;
};

/**
 * `/expenses/new` (PRD §8.8): a pending expense, or one already paid from an account. A paid expense in another
 * currency than its account asks for the amount debited in the account currency (§9.7). The schema of the action
 * resolves the form, so a field error shows before the call.
 */
export function ExpenseForm({ options, today }: ExpenseFormProps) {
  const t = useTranslations("expenses");
  const tRoot = useTranslations();
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: expenseResolver(options.accounts),
    defaultValues: {
      date: today,
      dueDate: "",
      description: "",
      vendor: "",
      categoryId: "",
      status: "PENDIENTE",
      accountId: NONE,
      projectId: NONE,
      currency: "USD",
      amount: "",
      usdRate: "1",
      paidAt: today,
      accountAmount: "",
    },
  });

  const errors = form.formState.errors;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;
  const status = useWatch({ control: form.control, name: "status" });
  const currency = useWatch({ control: form.control, name: "currency" });
  const accountId = useWatch({ control: form.control, name: "accountId" });
  const date = useWatch({ control: form.control, name: "date" });
  const account = options.accounts.find((item) => item.id === accountId);
  const isPaid = status === "PAGADO";
  const needsDebit = isPaid && account !== undefined && account.currency !== currency;
  const needsRate = currency !== "USD";

  async function lookupRate(
    lookupDate: string,
    rateCurrency: string,
  ): Promise<RateLookupResult | null> {
    const result = await lookupRateAction({ date: lookupDate, currency: rateCurrency });
    return result.ok && result.data ? (result.data as RateLookupResult) : null;
  }

  async function onSubmit() {
    setSaving(true);
    const result = await createExpenseAction(toExpenseInput(form.getValues(), options.accounts));
    setSaving(false);

    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(
        result.error.message ? tRoot(result.error.message as never) : tErrors(result.error.code),
      );
      return;
    }

    toast.success(t("toast.created"));
    router.push(`/expenses/${result.data.id}`);
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormPage
        title={t("form.createTitle")}
        description={t("form.description")}
        backHref="/expenses/list"
        dirty={form.formState.isDirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href="/expenses/list">{tActions("cancel")}</Link>
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
          title={t("form.sections.expense.title")}
          description={t("form.sections.expense.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.description ? true : undefined}>
              <FieldLabel htmlFor="expense-description">{t("form.fields.description")}</FieldLabel>
              <Input
                id="expense-description"
                aria-invalid={errors.description ? true : undefined}
                {...form.register("description")}
              />
              <FieldError>{fieldMessage(errors.description?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.vendor ? true : undefined}>
              <FieldLabel htmlFor="expense-vendor">{t("form.fields.vendor")}</FieldLabel>
              <Input id="expense-vendor" {...form.register("vendor")} />
              <FieldError>{fieldMessage(errors.vendor?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.categoryId ? true : undefined}>
              <FieldLabel htmlFor="expense-category">{t("form.fields.category")}</FieldLabel>
              <Controller
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="expense-category" className="w-full">
                      <SelectValue placeholder={t("form.placeholders.category")} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{fieldMessage(errors.categoryId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.projectId ? true : undefined}>
              <FieldLabel htmlFor="expense-project">{t("form.fields.project")}</FieldLabel>
              <Controller
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="expense-project" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("form.none")}</SelectItem>
                      {options.projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>{t("form.hints.project")}</FieldDescription>
              <FieldError>{fieldMessage(errors.projectId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.date ? true : undefined}>
              <FieldLabel htmlFor="expense-date">{t("form.fields.date")}</FieldLabel>
              <Controller
                control={form.control}
                name="date"
                render={({ field }) => (
                  <DateField
                    id="expense-date"
                    value={field.value}
                    max={today}
                    onChange={field.onChange}
                  />
                )}
              />
              <FieldError>{fieldMessage(errors.date?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.dueDate ? true : undefined}>
              <FieldLabel htmlFor="expense-due-date">{t("form.fields.dueDate")}</FieldLabel>
              <Controller
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <DateField
                    id="expense-due-date"
                    value={field.value}
                    min={date || undefined}
                    onChange={field.onChange}
                  />
                )}
              />
              <FieldDescription>{t("form.hints.dueDate")}</FieldDescription>
              <FieldError>{fieldMessage(errors.dueDate?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.payment.title")}
          description={t("form.sections.payment.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.status ? true : undefined}>
              <FieldLabel htmlFor="expense-status">{t("form.fields.status")}</FieldLabel>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="expense-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CREATE_STATUS_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {tEnums(`ExpenseStatus.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{fieldMessage(errors.status?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.accountId ? true : undefined}>
              <FieldLabel htmlFor="expense-account">{t("form.fields.account")}</FieldLabel>
              <Controller
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="expense-account" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("form.none")}</SelectItem>
                      {options.accounts.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {`${item.name} · ${item.currency}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>
                {isPaid ? t("form.hints.accountRequired") : t("form.hints.accountOptional")}
              </FieldDescription>
              <FieldError>{fieldMessage(errors.accountId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.currency ? true : undefined}>
              <FieldLabel htmlFor="expense-currency">{t("form.fields.currency")}</FieldLabel>
              <Controller
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="expense-currency" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.currencies.map((item) => (
                        <SelectItem key={item.code} value={item.code}>
                          {`${item.code} · ${item.name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{fieldMessage(errors.currency?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.amount ? true : undefined}>
              <FieldLabel htmlFor="expense-amount">
                {t("form.fields.amount", { currency })}
              </FieldLabel>
              <Input id="expense-amount" inputMode="decimal" {...form.register("amount")} />
              <FieldError>{fieldMessage(errors.amount?.message)}</FieldError>
            </Field>
            {needsRate ? (
              <Field data-invalid={errors.usdRate ? true : undefined}>
                <FieldLabel htmlFor="expense-usd-rate">
                  {t("form.fields.usdRate", { currency })}
                </FieldLabel>
                <Controller
                  control={form.control}
                  name="usdRate"
                  render={({ field }) => (
                    <RateInput
                      id="expense-usd-rate"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      date={date}
                      currency={currency}
                      lookupRate={lookupRate}
                    />
                  )}
                />
                <FieldError>{fieldMessage(errors.usdRate?.message)}</FieldError>
              </Field>
            ) : null}
            {isPaid ? (
              <Field data-invalid={errors.paidAt ? true : undefined}>
                <FieldLabel htmlFor="expense-paid-at">{t("form.fields.paidAt")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="paidAt"
                  render={({ field }) => (
                    <DateField
                      id="expense-paid-at"
                      value={field.value}
                      max={today}
                      onChange={field.onChange}
                    />
                  )}
                />
                <FieldError>{fieldMessage(errors.paidAt?.message)}</FieldError>
              </Field>
            ) : null}
            {needsDebit ? (
              <Field data-invalid={errors.accountAmount ? true : undefined}>
                <FieldLabel htmlFor="expense-account-amount">
                  {t("form.fields.accountAmount", { currency: account?.currency ?? "" })}
                </FieldLabel>
                <Input
                  id="expense-account-amount"
                  inputMode="decimal"
                  {...form.register("accountAmount")}
                />
                <FieldDescription>{t("form.hints.accountAmount")}</FieldDescription>
                <FieldError>{fieldMessage(errors.accountAmount?.message)}</FieldError>
              </Field>
            ) : null}
          </div>
        </SectionCard>
      </FormPage>
    </form>
  );
}
