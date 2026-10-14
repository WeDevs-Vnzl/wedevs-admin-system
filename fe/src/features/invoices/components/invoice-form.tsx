"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { MoneyText } from "@/components/patterns/money-text";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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
import { computeInvoiceTotals, type InvoiceTotals } from "@/lib/finance";
import { addDays, type DateOnly } from "@/lib/dates";
import { isDecimalString, isZeroMoney } from "@/lib/money";
import {
  createInvoiceAction,
  listBillableInstallmentsAction,
  updateInvoiceAction,
} from "@/features/invoices/actions";
import {
  createInvoiceInputSchema,
  updateInvoiceInputSchema,
  type BillableInstallmentRow,
  type CreateInvoiceInput,
  type InvoiceDetailDTO,
} from "@/lib/validators/invoices";
import { InvoiceTotalsPanel } from "./invoice-totals-panel";

// The select value that stands for an exempt line (`ivaRate: null`).
const EXEMPT = "exempt";
const FIELD_NAMES = [
  "clientId",
  "invoiceNumber",
  "controlNumber",
  "issueDate",
  "dueDate",
  "currency",
  "usdRate",
  "bcvRate",
  "ivaWithheld",
  "islrWithheld",
  "otherWithheld",
  "otherWithheldNote",
  "isDraft",
] as const;

type Option = { code: string; name: string };
type ClientOption = { id: string; name: string };

export type InvoiceFormProps = {
  /** Present on `/invoices/[id]/edit`; absent on `/invoices/new`. */
  invoice?: InvoiceDetailDTO;
  clients: ClientOption[];
  currencies: Option[];
  /** Allowed VAT rates of the fiscal settings, and the default one for a new line. */
  ivaRates: readonly string[];
  defaultIvaRate: string;
  today: DateOnly;
  defaultDueDays: number;
  /** "Facturar cuotas": the client's pending installments, and the ones preselected from the URL. */
  initialClientId: string;
  billable: BillableInstallmentRow[];
  preselected: BillableInstallmentRow[];
};

type LineValues = CreateInvoiceInput["lines"][number];

/** A line created from an installment: one line per installment, the remaining amount as default price. */
function lineFromInstallment(row: BillableInstallmentRow, ivaRate: string): LineValues {
  return {
    description: row.label,
    projectId: row.project.id,
    installmentId: row.installment.id,
    quantity: "1",
    unitPrice: row.remainingAmount,
    discount: "0.00",
    ivaRate,
  } as LineValues;
}

function emptyLine(ivaRate: string): LineValues {
  return { description: "", quantity: "1", unitPrice: "", discount: "0", ivaRate } as LineValues;
}

/** Totals of the lines as typed (C17 through `lib/finance`); a half-typed line is left out of the preview. */
function previewTotals(
  lines: readonly Partial<LineValues>[],
  adjustments: Readonly<Record<string, string>>,
  money: { ivaWithheld?: string; islrWithheld?: string; otherWithheld?: string; usdRate?: string },
): { totals: InvoiceTotals | null } {
  const valid = lines
    .map((line) => ({
      quantity: line.quantity || "1",
      unitPrice: line.unitPrice ?? "",
      discount: line.discount || "0",
      ivaRate: line.ivaRate ?? null,
    }))
    .filter(
      (line) =>
        isDecimalString(line.quantity) &&
        isDecimalString(line.unitPrice) &&
        isDecimalString(line.discount),
    );
  const usedRates = new Set(valid.flatMap((line) => (line.ivaRate === null ? [] : [line.ivaRate])));
  const taxAdjustments = Object.entries(adjustments)
    .filter(([rate, value]) => usedRates.has(rate) && isDecimalString(value) && !isZeroMoney(value))
    .map(([ivaRate, adjustment]) => ({ ivaRate, adjustment }));
  const withheld = (value?: string) => (value && isDecimalString(value) ? value : "0.00");
  try {
    return {
      totals: computeInvoiceTotals({
        lines: valid,
        taxAdjustments,
        ivaWithheld: withheld(money.ivaWithheld),
        islrWithheld: withheld(money.islrWithheld),
        otherWithheld: withheld(money.otherWithheld),
        usdRate: money.usdRate && isDecimalString(money.usdRate) ? money.usdRate : "1",
      }),
    };
  } catch {
    return { totals: null };
  }
}

/**
 * Create and edit form of an invoice (PRD §8.5, HU-11, DT-44). A line grid where each line has its own VAT rate
 * (or exempt) and an optional discount; the per-rate totals are computed live through `lib/finance`. The IVA
 * adjustment is ±0.01 per rate. "Facturar cuotas" adds one line per selected installment of the client.
 * The schemas of the actions resolve the form, so a field error shows before the call.
 */
export function InvoiceForm({
  invoice,
  clients,
  currencies,
  ivaRates,
  defaultIvaRate,
  today,
  defaultDueDays,
  initialClientId,
  billable: initialBillable,
  preselected,
}: InvoiceFormProps) {
  const t = useTranslations("invoices");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [billable, setBillable] = useState(initialBillable);
  const nonZeroRates = ivaRates.filter((rate) => !isZeroMoney(rate));
  const [adjustments, setAdjustments] = useState<Record<string, string>>(() =>
    Object.fromEntries((invoice?.taxLines ?? []).map((line) => [line.ivaRate, line.adjustment])),
  );

  const defaultLines: LineValues[] = invoice
    ? (invoice.lines.map((line) => ({
        id: line.id,
        description: line.description,
        projectId: line.project?.id,
        installmentId: line.installment?.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        ivaRate: line.ivaRate,
      })) as LineValues[])
    : preselected.map((row) => lineFromInstallment(row, defaultIvaRate));

  const form = useForm<CreateInvoiceInput>({
    resolver: zodResolver(invoice ? updateInvoiceInputSchema : createInvoiceInputSchema) as never,
    defaultValues: invoice
      ? {
          clientId: invoice.client.id,
          invoiceNumber: invoice.invoiceNumber,
          controlNumber: invoice.controlNumber ?? "",
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          currency: invoice.currency,
          usdRate: invoice.usdRate,
          bcvRate: invoice.bcvRate ?? "",
          isDraft: invoice.isDraft,
          lines: defaultLines,
          ivaWithheld: invoice.totals.ivaWithheld,
          islrWithheld: invoice.totals.islrWithheld,
          otherWithheld: invoice.totals.otherWithheld,
          otherWithheldNote: invoice.totals.otherWithheldNote ?? "",
        }
      : {
          clientId: initialClientId,
          invoiceNumber: "",
          controlNumber: "",
          issueDate: today,
          dueDate: addDays(today, defaultDueDays),
          currency: "USD",
          usdRate: "1",
          bcvRate: "",
          isDraft: false,
          lines: defaultLines.length > 0 ? defaultLines : [emptyLine(defaultIvaRate)],
          ivaWithheld: "0",
          islrWithheld: "0",
          otherWithheld: "0",
          otherWithheldNote: "",
        },
  });

  const lines = useFieldArray({ control: form.control, name: "lines" });
  const watched = useWatch({ control: form.control }) as Partial<CreateInvoiceInput>;
  const preview = useMemo(
    () =>
      previewTotals(watched.lines ?? [], adjustments, {
        ivaWithheld: watched.ivaWithheld,
        islrWithheld: watched.islrWithheld,
        otherWithheld: watched.otherWithheld,
        usdRate: watched.usdRate,
      }),
    [watched, adjustments],
  );
  const usedRates = new Set(
    (watched.lines ?? []).flatMap((line) => (line.ivaRate ? [line.ivaRate] : [])),
  );
  const selectedInstallments = new Set(
    (watched.lines ?? []).flatMap((line) => (line.installmentId ? [line.installmentId] : [])),
  );

  const errors = form.formState.errors;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;

  async function onClientChange(clientId: string) {
    form.setValue("clientId", clientId, { shouldDirty: true });
    // Installment lines belong to the previous client: they go, and the new client's options come in.
    for (let index = lines.fields.length - 1; index >= 0; index -= 1) {
      if (lines.fields[index]?.installmentId) lines.remove(index);
    }
    const result = await listBillableInstallmentsAction({ clientId });
    setBillable(result.ok ? (result.data as BillableInstallmentRow[]) : []);
  }

  function toggleInstallment(row: BillableInstallmentRow, checked: boolean) {
    if (checked) {
      lines.append(lineFromInstallment(row, defaultIvaRate));
      return;
    }
    const index = lines.fields.findIndex((line) => line.installmentId === row.installment.id);
    if (index >= 0) lines.remove(index);
  }

  async function onSubmit(values: CreateInvoiceInput) {
    setSaving(true);
    const payload = {
      ...values,
      controlNumber: values.controlNumber || undefined,
      bcvRate: values.bcvRate || undefined,
      otherWithheldNote: values.otherWithheldNote || undefined,
      taxAdjustments: Object.entries(adjustments)
        .filter(([rate, value]) => usedRates.has(rate) && value.trim() !== "")
        .map(([ivaRate, adjustment]) => ({ ivaRate, adjustment: adjustment.trim() })),
    };
    const result = invoice
      ? await updateInvoiceAction({ ...payload, id: invoice.id })
      : await createInvoiceAction(payload as CreateInvoiceInput);
    setSaving(false);

    if (!result.ok) {
      const { error } = result;
      if (error.fieldErrors) {
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const message = messages[0];
          if (!message) continue;
          if (field.startsWith("lines.") || (FIELD_NAMES as readonly string[]).includes(field)) {
            form.setError(field as never, { message: tRoot(message as never) });
          }
        }
      }
      toast.error(tErrors(error.code));
      return;
    }

    toast.success(invoice ? t("toast.updated") : t("toast.created"));
    router.push(`/invoices/${result.data.id}`);
  }

  const backHref = invoice ? `/invoices/${invoice.id}` : "/invoices/list";
  const clientName = (id: string) => clients.find((client) => client.id === id)?.name;

  return (
    <form id="invoice-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormPage
        title={invoice ? t("form.editTitle") : t("form.createTitle")}
        description={t("form.description")}
        backHref={backHref}
        dirty={form.formState.isDirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href={backHref}>{tActions("cancel")}</Link>
            </Button>
            <Button type="submit" form="invoice-form" disabled={saving}>
              {tActions("save")}
            </Button>
          </>
        }
      >
        <SectionCard
          group
          span={1}
          title={t("form.sections.header.title")}
          description={t("form.sections.header.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={form.formState.errors.clientId ? true : undefined}>
              <FieldLabel htmlFor="invoice-client">{t("form.fields.client")}</FieldLabel>
              <Controller
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => void onClientChange(value)}
                    disabled={Boolean(invoice)}
                  >
                    <SelectTrigger id="invoice-client" className="w-full">
                      <SelectValue placeholder={t("form.fields.clientPlaceholder")}>
                        {clientName(field.value)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>{fieldMessage(form.formState.errors.clientId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.invoiceNumber ? true : undefined}>
              <FieldLabel htmlFor="invoice-number">{t("form.fields.invoiceNumber")}</FieldLabel>
              <Input
                id="invoice-number"
                aria-invalid={errors.invoiceNumber ? true : undefined}
                {...form.register("invoiceNumber")}
              />
              <FieldError>{fieldMessage(errors.invoiceNumber?.message)}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="invoice-control">{t("form.fields.controlNumber")}</FieldLabel>
              <Input id="invoice-control" {...form.register("controlNumber")} />
            </Field>
            <Field data-invalid={errors.issueDate ? true : undefined}>
              <FieldLabel htmlFor="invoice-issue">{t("form.fields.issueDate")}</FieldLabel>
              <Input id="invoice-issue" type="date" {...form.register("issueDate")} />
              <FieldError>{fieldMessage(errors.issueDate?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.dueDate ? true : undefined}>
              <FieldLabel htmlFor="invoice-due">{t("form.fields.dueDate")}</FieldLabel>
              <Input id="invoice-due" type="date" {...form.register("dueDate")} />
              <FieldError>{fieldMessage(errors.dueDate?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.currency ? true : undefined}>
              <FieldLabel htmlFor="invoice-currency">{t("form.fields.currency")}</FieldLabel>
              <Controller
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="invoice-currency" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((currency) => (
                        <SelectItem key={currency.code} value={currency.code}>
                          {currency.code} · {currency.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field data-invalid={errors.usdRate ? true : undefined}>
              <FieldLabel htmlFor="invoice-usd-rate">{t("form.fields.usdRate")}</FieldLabel>
              <Input id="invoice-usd-rate" inputMode="decimal" {...form.register("usdRate")} />
              <FieldError>{fieldMessage(errors.usdRate?.message)}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="invoice-draft">{t("form.fields.isDraft")}</FieldLabel>
              <Controller
                control={form.control}
                name="isDraft"
                render={({ field }) => (
                  <Switch
                    id="invoice-draft"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.installments.title")}
          description={t("form.sections.installments.description")}
        >
          {billable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("form.installments.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {billable.map((row) => {
                const checked = selectedInstallments.has(row.installment.id);
                return (
                  <li key={row.installment.id} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      id={`installment-${row.installment.id}`}
                      checked={checked}
                      onCheckedChange={(value) => toggleInstallment(row, value === true)}
                      aria-label={t("form.installments.select", { label: row.label })}
                    />
                    <label htmlFor={`installment-${row.installment.id}`} className="flex-1">
                      {row.label} · {row.project.label}
                    </label>
                    <MoneyText amount={row.remainingAmount} currency={row.currency} />
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.lines.title")}
          description={t("form.sections.lines.description")}
        >
          <div className="flex flex-col gap-3">
            {lines.fields.map((item, index) => (
              <div
                key={item.id}
                className="grid items-start gap-3 @lg:grid-cols-[minmax(0,2fr)_90px_120px_100px_120px_auto]"
              >
                <Field data-invalid={errors.lines?.[index]?.description ? true : undefined}>
                  <FieldLabel htmlFor={`line-${index}-description`} className="sr-only">
                    {t("form.line.description")}
                  </FieldLabel>
                  <Input
                    id={`line-${index}-description`}
                    placeholder={t("form.line.description")}
                    {...form.register(`lines.${index}.description`)}
                  />
                  <FieldError>
                    {fieldMessage(errors.lines?.[index]?.description?.message)}
                  </FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`line-${index}-quantity`} className="sr-only">
                    {t("form.line.quantity")}
                  </FieldLabel>
                  <Input
                    id={`line-${index}-quantity`}
                    inputMode="decimal"
                    {...form.register(`lines.${index}.quantity`)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`line-${index}-price`} className="sr-only">
                    {t("form.line.unitPrice")}
                  </FieldLabel>
                  <Input
                    id={`line-${index}-price`}
                    inputMode="decimal"
                    placeholder={t("form.line.unitPrice")}
                    {...form.register(`lines.${index}.unitPrice`)}
                  />
                  <FieldError>{fieldMessage(errors.lines?.[index]?.unitPrice?.message)}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`line-${index}-discount`} className="sr-only">
                    {t("form.line.discount")}
                  </FieldLabel>
                  <Input
                    id={`line-${index}-discount`}
                    inputMode="decimal"
                    placeholder={t("form.line.discount")}
                    {...form.register(`lines.${index}.discount`)}
                  />
                  <FieldError>{fieldMessage(errors.lines?.[index]?.discount?.message)}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`line-${index}-rate`} className="sr-only">
                    {t("form.line.ivaRate")}
                  </FieldLabel>
                  <Controller
                    control={form.control}
                    name={`lines.${index}.ivaRate`}
                    render={({ field }) => (
                      <Select
                        value={field.value ?? EXEMPT}
                        onValueChange={(value) => field.onChange(value === EXEMPT ? null : value)}
                      >
                        <SelectTrigger id={`line-${index}-rate`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ivaRates.map((rate) => (
                            <SelectItem key={rate} value={rate}>
                              {t("rate", { rate })}
                            </SelectItem>
                          ))}
                          <SelectItem value={EXEMPT}>{t("form.line.exempt")}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("form.line.remove")}
                  onClick={() => lines.remove(index)}
                  disabled={lines.fields.length === 1}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <FieldError>
              {fieldMessage(errors.lines?.root?.message ?? errors.lines?.message)}
            </FieldError>
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => lines.append(emptyLine(defaultIvaRate))}
              >
                <Plus aria-hidden />
                {t("form.line.add")}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.adjustments.title")}
          description={t("form.sections.adjustments.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            {nonZeroRates
              .filter((rate) => usedRates.has(rate))
              .map((rate) => (
                <Field key={rate}>
                  <FieldLabel htmlFor={`adjustment-${rate}`}>
                    {t("form.fields.adjustment", { rate })}
                  </FieldLabel>
                  <Input
                    id={`adjustment-${rate}`}
                    inputMode="decimal"
                    value={adjustments[rate] ?? ""}
                    onChange={(event) =>
                      setAdjustments((current) => ({ ...current, [rate]: event.target.value }))
                    }
                  />
                </Field>
              ))}
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.withholdings.title")}
          description={t("form.sections.withholdings.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.ivaWithheld ? true : undefined}>
              <FieldLabel htmlFor="invoice-iva-withheld">{t("form.fields.ivaWithheld")}</FieldLabel>
              <Input
                id="invoice-iva-withheld"
                inputMode="decimal"
                {...form.register("ivaWithheld")}
              />
              <FieldError>{fieldMessage(errors.ivaWithheld?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.islrWithheld ? true : undefined}>
              <FieldLabel htmlFor="invoice-islr-withheld">
                {t("form.fields.islrWithheld")}
              </FieldLabel>
              <Input
                id="invoice-islr-withheld"
                inputMode="decimal"
                {...form.register("islrWithheld")}
              />
              <FieldError>{fieldMessage(errors.islrWithheld?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.otherWithheld ? true : undefined}>
              <FieldLabel htmlFor="invoice-other-withheld">
                {t("form.fields.otherWithheld")}
              </FieldLabel>
              <Input
                id="invoice-other-withheld"
                inputMode="decimal"
                {...form.register("otherWithheld")}
              />
              <FieldError>{fieldMessage(errors.otherWithheld?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.otherWithheldNote ? true : undefined}>
              <FieldLabel htmlFor="invoice-other-note">
                {t("form.fields.otherWithheldNote")}
              </FieldLabel>
              <Textarea id="invoice-other-note" rows={2} {...form.register("otherWithheldNote")} />
              <FieldError>{fieldMessage(errors.otherWithheldNote?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.totals.title")}
          description={t("form.sections.totals.description")}
        >
          {preview.totals ? (
            <InvoiceTotalsPanel totals={preview.totals} currency={watched.currency ?? "USD"} />
          ) : (
            <p className="text-sm text-destructive">{t("form.totalsInvalid")}</p>
          )}
        </SectionCard>
      </FormPage>
    </form>
  );
}
