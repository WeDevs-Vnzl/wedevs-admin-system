"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field/date-field";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createRecurringExpenseAction,
  updateRecurringExpenseAction,
} from "@/features/expenses/actions";
import type { ExpenseFormOptions } from "@/features/expenses/form-options";
import { applyFieldErrors, asSchemaValue } from "@/features/expenses/components/form-utils";
import { FormPage } from "@/components/patterns/form-page";
import { SectionCard } from "@/components/patterns/section-card";
import {
  createRecurringExpenseInputSchema,
  updateRecurringExpenseInputSchema,
  DEFAULT_RECURRING_EXPENSE_LEAD_DAYS,
  type RecurringExpenseDTO,
} from "@/lib/validators/expenses";
import { FREQUENCY_VALUES } from "@/lib/validators/enums";

const FORM_ID = "recurring-expense-form";
const NONE = "__none__";
const FIELDS = [
  "name",
  "vendor",
  "categoryId",
  "accountId",
  "projectId",
  "currency",
  "amount",
  "frequency",
  "dayOfPeriod",
  "leadDays",
  "startDate",
  "endDate",
] as const;

type FormValues = {
  name: string;
  vendor: string;
  categoryId: string;
  accountId: string;
  projectId: string;
  currency: string;
  amount: string;
  frequency: (typeof FREQUENCY_VALUES)[number];
  dayOfPeriod: string;
  leadDays: string;
  startDate: string;
  endDate: string;
};

type RecurringExpenseFormProps = {
  options: ExpenseFormOptions;
  /** Business "today" (America/Caracas), computed on the server; the default start of a new schedule. */
  today: string;
  /** Present on `/expenses/recurring/[id]`; absent on `/expenses/recurring/new`. */
  recurring?: RecurringExpenseDTO;
};

/** The payload of the schedule: blank optional fields absent, the day and the lead days as whole numbers. */
function toRecurringInput(values: FormValues) {
  const raw = asSchemaValue(values, NONE);
  return {
    name: values.name,
    vendor: raw.vendor,
    categoryId: values.categoryId,
    accountId: raw.accountId,
    projectId: raw.projectId,
    currency: values.currency,
    amount: values.amount.trim(),
    frequency: values.frequency,
    dayOfPeriod: Number(values.dayOfPeriod),
    leadDays: Number(values.leadDays),
    startDate: values.startDate,
    endDate: raw.endDate,
  };
}

/**
 * Create and edit form of a recurring expense (PRD §8.8, HU-17). The lead days default to 5 (§8.8). A change of
 * amount applies to the periods not generated yet; the generated expenses keep theirs (see the service).
 */
export function RecurringExpenseForm({ options, today, recurring }: RecurringExpenseFormProps) {
  const t = useTranslations("expenses");
  const tRoot = useTranslations();
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const resolve = zodResolver(
    recurring ? updateRecurringExpenseInputSchema : createRecurringExpenseInputSchema,
  ) as unknown as Resolver<FormValues>;
  const resolver: Resolver<FormValues> = (values, context, resolverOptions) => {
    const input = toRecurringInput(values);
    return resolve(
      (recurring ? { id: recurring.id, ...input } : input) as unknown as FormValues,
      context,
      resolverOptions,
    );
  };

  const form = useForm<FormValues>({
    resolver,
    defaultValues: recurring
      ? {
          name: recurring.name,
          vendor: recurring.vendor ?? "",
          categoryId: recurring.category.id,
          accountId: recurring.account?.id ?? NONE,
          projectId: recurring.project?.id ?? NONE,
          currency: recurring.currency,
          amount: recurring.amount,
          frequency: recurring.frequency,
          dayOfPeriod: String(recurring.dayOfPeriod),
          leadDays: String(recurring.leadDays),
          startDate: recurring.startDate,
          endDate: recurring.endDate ?? "",
        }
      : {
          name: "",
          vendor: "",
          categoryId: "",
          accountId: NONE,
          projectId: NONE,
          currency: "USD",
          amount: "",
          frequency: "MENSUAL",
          dayOfPeriod: "5",
          leadDays: String(DEFAULT_RECURRING_EXPENSE_LEAD_DAYS),
          startDate: today,
          endDate: "",
        },
  });

  const errors = form.formState.errors;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;
  const currency = useWatch({ control: form.control, name: "currency" });
  const startDate = useWatch({ control: form.control, name: "startDate" });

  async function onSubmit() {
    setSaving(true);
    const input = toRecurringInput(form.getValues());
    const result = recurring
      ? await updateRecurringExpenseAction({ id: recurring.id, ...input })
      : await createRecurringExpenseAction(input);
    setSaving(false);

    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(
        result.error.message ? tRoot(result.error.message as never) : tErrors(result.error.code),
      );
      return;
    }

    if (recurring) {
      toast.success(t("toast.recurringUpdated"));
      router.refresh();
      return;
    }
    toast.success(t("toast.recurringCreated"));
    router.push(`/expenses/recurring/${result.data.id}`);
  }

  const backHref = recurring ? `/expenses/recurring/${recurring.id}` : "/expenses/recurring";

  return (
    <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormPage
        title={recurring ? t("recurring.form.editTitle") : t("recurring.form.createTitle")}
        description={t("recurring.form.description")}
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
          title={t("recurring.form.sections.identity.title")}
          description={t("recurring.form.sections.identity.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="recurring-name">{t("recurring.form.fields.name")}</FieldLabel>
              <Input
                id="recurring-name"
                aria-invalid={errors.name ? true : undefined}
                {...form.register("name")}
              />
              <FieldError>{fieldMessage(errors.name?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.vendor ? true : undefined}>
              <FieldLabel htmlFor="recurring-vendor">
                {t("recurring.form.fields.vendor")}
              </FieldLabel>
              <Input id="recurring-vendor" {...form.register("vendor")} />
              <FieldError>{fieldMessage(errors.vendor?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.categoryId ? true : undefined}>
              <FieldLabel htmlFor="recurring-category">
                {t("recurring.form.fields.category")}
              </FieldLabel>
              <Controller
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="recurring-category" className="w-full">
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
            <Field data-invalid={errors.accountId ? true : undefined}>
              <FieldLabel htmlFor="recurring-account">
                {t("recurring.form.fields.account")}
              </FieldLabel>
              <Controller
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="recurring-account" className="w-full">
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
              <FieldDescription>{t("recurring.form.hints.account")}</FieldDescription>
              <FieldError>{fieldMessage(errors.accountId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.projectId ? true : undefined}>
              <FieldLabel htmlFor="recurring-project">
                {t("recurring.form.fields.project")}
              </FieldLabel>
              <Controller
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="recurring-project" className="w-full">
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
              <FieldError>{fieldMessage(errors.projectId?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("recurring.form.sections.schedule.title")}
          description={t("recurring.form.sections.schedule.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.currency ? true : undefined}>
              <FieldLabel htmlFor="recurring-currency">
                {t("recurring.form.fields.currency")}
              </FieldLabel>
              <Controller
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="recurring-currency" className="w-full">
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
              <FieldLabel htmlFor="recurring-amount">
                {t("recurring.form.fields.amount", { currency })}
              </FieldLabel>
              <Input id="recurring-amount" inputMode="decimal" {...form.register("amount")} />
              <FieldDescription>{t("recurring.form.hints.amount")}</FieldDescription>
              <FieldError>{fieldMessage(errors.amount?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.frequency ? true : undefined}>
              <FieldLabel htmlFor="recurring-frequency">
                {t("recurring.form.fields.frequency")}
              </FieldLabel>
              <Controller
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="recurring-frequency" className="w-full">
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
              <FieldError>{fieldMessage(errors.frequency?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.dayOfPeriod ? true : undefined}>
              <FieldLabel htmlFor="recurring-day">
                {t("recurring.form.fields.dayOfPeriod")}
              </FieldLabel>
              <Input id="recurring-day" inputMode="numeric" {...form.register("dayOfPeriod")} />
              <FieldDescription>{t("recurring.form.hints.dayOfPeriod")}</FieldDescription>
              <FieldError>{fieldMessage(errors.dayOfPeriod?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.leadDays ? true : undefined}>
              <FieldLabel htmlFor="recurring-lead-days">
                {t("recurring.form.fields.leadDays")}
              </FieldLabel>
              <Input id="recurring-lead-days" inputMode="numeric" {...form.register("leadDays")} />
              <FieldDescription>{t("recurring.form.hints.leadDays")}</FieldDescription>
              <FieldError>{fieldMessage(errors.leadDays?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.startDate ? true : undefined}>
              <FieldLabel htmlFor="recurring-start">
                {t("recurring.form.fields.startDate")}
              </FieldLabel>
              <Controller
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <DateField id="recurring-start" value={field.value} onChange={field.onChange} />
                )}
              />
              <FieldError>{fieldMessage(errors.startDate?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.endDate ? true : undefined}>
              <FieldLabel htmlFor="recurring-end">{t("recurring.form.fields.endDate")}</FieldLabel>
              <Controller
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <DateField
                    id="recurring-end"
                    value={field.value}
                    min={startDate || undefined}
                    onChange={field.onChange}
                  />
                )}
              />
              <FieldDescription>{t("recurring.form.hints.endDate")}</FieldDescription>
              <FieldError>{fieldMessage(errors.endDate?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>
      </FormPage>
    </form>
  );
}
