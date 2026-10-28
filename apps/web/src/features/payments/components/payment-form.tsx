"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { MoneyText } from "@/components/patterns/money-text";
import { SectionCard } from "@/components/patterns/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Uploader } from "@/components/ui/uploader";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import { lookupRateAction } from "@/features/catalogs/actions";
import { uploadAdapter } from "@/features/files/upload-adapter";
import { proposeIgtfAmount } from "@/lib/finance";
import {
  createPaymentAction,
  detectDuplicatePaymentAction,
  listOpenInvoicesAction,
} from "@/features/payments/actions";
import { computePaymentAmounts, proposeAllocation } from "@/lib/finance";
import type { OpenInvoiceOption } from "@/features/payments/types";
import { compareMoney, isDecimalString, type MoneyString } from "@/lib/money";
import { createPaymentInputSchema, type DuplicatePaymentMatch } from "@/lib/validators/payments";
import type { DateOnly } from "@/lib/dates";

const FORM_ID = "payment-form";
const FIELD_NAMES = [
  "clientId",
  "date",
  "accountId",
  "methodId",
  "amount",
  "igtfAmount",
  "feeAmount",
  "usdRate",
  "reference",
  "receiptFileId",
] as const;

export type PaymentFormClient = { id: string; name: string };
export type PaymentFormAccount = { id: string; name: string; currency: string };
export type PaymentFormMethod = {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  requiresReference: boolean;
  suggestsIgtf: boolean;
};

export type PaymentFormProps = {
  clients: PaymentFormClient[];
  /** Active accounts only: a payment enters an active account. */
  accounts: PaymentFormAccount[];
  /** Active methods, with their reference and IGTF rules. */
  methods: PaymentFormMethod[];
  fiscal: { igtfRate: MoneyString; igtfCurrencies: string[] };
  /** Business "today" (America/Caracas), computed on the server. */
  today: DateOnly;
  /** Client preselected from `?invoiceId=`, with its open invoices. */
  initialClientId?: string;
  initialOpenInvoices: OpenInvoiceOption[];
  /** Invoice preselected by `?invoiceId=`: it is ticked, with its balance as the amount. */
  initialInvoiceId?: string;
};

type PaymentFormValues = {
  clientId: string;
  date: string;
  accountId: string;
  methodId: string;
  currency: string;
  amount: string;
  igtfAmount: string;
  feeAmount: string;
  usdRate: string;
  reference: string;
  receiptFileId?: string | undefined;
};

/** State of one invoice row of "Aplicar a facturas". `invoiceAmount` is set only when the user edits it. */
type AppliedRow = { selected: boolean; amountPayment: string; invoiceAmount?: string | undefined };

/** Proposed amount in the invoice currency, from the payment-date rate (HU-13 CA4), or `null` when not computable. */
function proposeInvoiceAmount(
  amountPayment: string,
  paymentCurrency: string,
  paymentUsdRate: string,
  invoice: OpenInvoiceOption,
): string | null {
  if (!isDecimalString(amountPayment) || compareMoney(amountPayment, "0") <= 0) return null;
  if (!isDecimalString(paymentUsdRate) || compareMoney(paymentUsdRate, "0") <= 0) return null;
  return proposeAllocation({
    amountPaymentCurrency: amountPayment,
    paymentCurrency,
    paymentUsdRate,
    invoiceCurrency: invoice.currency,
    invoiceUsdRateOnPaymentDate: invoice.currency === "USD" ? "1" : invoice.usdRate,
  }).amountInvoiceCurrency;
}

/**
 * Payment form (HU-13, HU-14). The fields of the contract are required (CA1), the reference when the method asks
 * for it. IGTF is proposed from the fiscal settings (DT-70) and stays editable. The unallocated rest is credit
 * (CA5). Possible duplicates are shown as a warning, never as a refusal (CA6).
 */
export function PaymentForm({
  clients,
  accounts,
  methods,
  fiscal,
  today,
  initialClientId,
  initialOpenInvoices,
  initialInvoiceId,
}: PaymentFormProps) {
  const t = useTranslations("payments");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const locale = useLocale();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceOption[]>(initialOpenInvoices);
  const [igtfEdited, setIgtfEdited] = useState(false);
  const [duplicateResult, setDuplicateResult] = useState<{
    key: string;
    matches: DuplicatePaymentMatch[];
  }>({ key: "", matches: [] });

  const initialAccount = accounts.find((account) => account.currency === "USD") ?? accounts[0];
  const initialInvoice = initialOpenInvoices.find((invoice) => invoice.id === initialInvoiceId);
  const [applied, setApplied] = useState<Record<string, AppliedRow>>(() =>
    initialInvoice
      ? {
          [initialInvoice.id]: {
            selected: true,
            amountPayment:
              initialAccount?.currency === initialInvoice.currency ? initialInvoice.balance : "",
          },
        }
      : {},
  );

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(createPaymentInputSchema) as never,
    defaultValues: {
      clientId: initialClientId ?? clients[0]?.id ?? "",
      date: today,
      accountId: initialAccount?.id ?? "",
      methodId: methods[0]?.id ?? "",
      currency: initialAccount?.currency ?? "",
      amount: "",
      igtfAmount: "0.00",
      feeAmount: "0.00",
      usdRate: initialAccount?.currency === "USD" ? "1" : "",
      reference: "",
      receiptFileId: undefined,
    },
  });

  const errors = form.formState.errors;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;

  const clientId = useWatch({ control: form.control, name: "clientId" });
  const accountId = useWatch({ control: form.control, name: "accountId" });
  const methodId = useWatch({ control: form.control, name: "methodId" });
  const date = useWatch({ control: form.control, name: "date" });
  const amount = useWatch({ control: form.control, name: "amount" });
  const igtfAmount = useWatch({ control: form.control, name: "igtfAmount" });
  const feeAmount = useWatch({ control: form.control, name: "feeAmount" });
  const usdRate = useWatch({ control: form.control, name: "usdRate" });
  const reference = useWatch({ control: form.control, name: "reference" });

  const account = accounts.find((item) => item.id === accountId);
  const currency = account?.currency ?? "";
  const method = methods.find((item) => item.id === methodId);
  const isUsd = currency === "USD";
  const requiresReference = method?.requiresReference ?? false;

  // IGTF is proposed while the user has not edited it (DT-70): by the method flag or the currency list.
  useEffect(() => {
    if (igtfEdited || !method || !isDecimalString(amount) || currency === "") return;
    form.setValue(
      "igtfAmount",
      proposeIgtfAmount({
        amount,
        currency,
        suggestsIgtf: method.suggestsIgtf,
        igtfRate: fiscal.igtfRate,
        igtfCurrencies: fiscal.igtfCurrencies,
      }),
    );
  }, [amount, currency, method, igtfEdited, fiscal, form]);

  // Possible duplicate (CA6): the same reference, method and account. A warning only, looked up after a pause.
  const duplicateKey =
    methodId && accountId && reference.trim() !== ""
      ? `${methodId}|${accountId}|${reference.trim()}`
      : "";
  useEffect(() => {
    if (!duplicateKey) return;
    const timer = setTimeout(() => {
      void detectDuplicatePaymentAction({
        methodId,
        accountId,
        reference: reference.trim(),
      }).then((result) => {
        setDuplicateResult({
          key: duplicateKey,
          matches: result.ok && result.data ? result.data.matches : [],
        });
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [duplicateKey, methodId, accountId, reference]);
  const duplicates = duplicateResult.key === duplicateKey ? duplicateResult.matches : [];

  // Amounts shown live (lib/finance, C17): allocatable, net credited and the credit left on this payment.
  const amounts = useMemo(() => {
    const validAmount = isDecimalString(amount) ? amount : "0";
    const validIgtf = isDecimalString(igtfAmount) ? igtfAmount : "0";
    const validFee = isDecimalString(feeAmount) ? feeAmount : "0";
    const allocated = Object.values(applied)
      .filter((row) => row.selected && isDecimalString(row.amountPayment))
      .map((row) => row.amountPayment);
    if (compareMoney(validAmount, "0") <= 0 || compareMoney(validIgtf, validAmount) > 0) {
      return null;
    }
    return computePaymentAmounts({
      amount: validAmount,
      igtfAmount: validIgtf,
      feeAmount: compareMoney(validFee, validAmount) > 0 ? "0" : validFee,
      allocated,
    });
  }, [amount, igtfAmount, feeAmount, applied]);

  async function changeClient(nextClientId: string) {
    form.setValue("clientId", nextClientId, { shouldValidate: true });
    setApplied({});
    const result = await listOpenInvoicesAction({ clientId: nextClientId });
    setOpenInvoices(result.ok && result.data ? (result.data as OpenInvoiceOption[]) : []);
  }

  function changeAccount(nextAccountId: string) {
    const next = accounts.find((item) => item.id === nextAccountId);
    form.setValue("accountId", nextAccountId, { shouldValidate: true });
    form.setValue("currency", next?.currency ?? "");
    form.setValue("usdRate", next?.currency === "USD" ? "1" : "");
  }

  function setRow(invoiceId: string, patch: Partial<AppliedRow>) {
    setApplied((current) => ({
      ...current,
      [invoiceId]: { selected: false, amountPayment: "", ...current[invoiceId], ...patch },
    }));
  }

  async function lookupRate(lookupDate: string, rateCurrency: string) {
    const result = await lookupRateAction({ date: lookupDate, currency: rateCurrency });
    return result.ok && result.data ? (result.data as RateLookupResult) : null;
  }

  /** The allocations ticked in the section, with their invoice-currency amount (edited or proposed). */
  function buildAllocations() {
    return openInvoices.flatMap((invoice) => {
      const row = applied[invoice.id];
      if (!row?.selected || !isDecimalString(row.amountPayment)) return [];
      const proposal = proposeInvoiceAmount(row.amountPayment, currency, usdRate, invoice);
      const invoiceAmount = row.invoiceAmount ?? proposal ?? row.amountPayment;
      return [
        {
          invoiceId: invoice.id,
          amountPaymentCurrency: row.amountPayment,
          amountInvoiceCurrency: invoiceAmount,
        },
      ];
    });
  }

  async function onSubmit(values: PaymentFormValues) {
    // The reference rule follows the method (HU-13 CA1); the server repeats it. The resolver output drops a
    // blank reference to `undefined`, so the check must not assume a string.
    if (requiresReference && !values.reference?.trim()) {
      form.setError("reference", { message: "payments.validation.referenceRequired" });
      return;
    }
    const allocations = buildAllocations();
    const payload: Parameters<typeof createPaymentAction>[0] = {
      clientId: values.clientId,
      date: values.date,
      accountId: values.accountId,
      methodId: values.methodId,
      currency: values.currency,
      amount: values.amount,
      igtfAmount: values.igtfAmount,
      feeAmount: values.feeAmount,
      usdRate: isUsd ? "1" : values.usdRate,
      reference: values.reference || undefined,
      receiptFileId: values.receiptFileId || undefined,
      status: "CONFIRMADO",
      allocations,
    };

    setSaving(true);
    const result = await createPaymentAction(payload);
    setSaving(false);

    if (!result.ok) {
      const { error } = result;
      if (error.fieldErrors) {
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const message = messages[0];
          const root = field.split(".")[0] ?? "";
          if (message && (FIELD_NAMES as readonly string[]).includes(root)) {
            form.setError(root as (typeof FIELD_NAMES)[number], {
              message: tRoot(message as never),
            });
          }
        }
        const allocationMessage = Object.entries(error.fieldErrors).find(([key]) =>
          key.startsWith("allocations"),
        )?.[1]?.[0];
        if (allocationMessage) toast.error(tRoot(allocationMessage as never));
      }
      toast.error(tErrors(error.code));
      return;
    }

    toast.success(t("toast.created"));
    router.push(`/payments/${result.data.id}`);
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormPage
        title={t("form.title")}
        description={t("form.description")}
        backHref="/payments/list"
        dirty={form.formState.isDirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href="/payments">{tActions("cancel")}</Link>
            </Button>
            <Button type="submit" form={FORM_ID} disabled={saving}>
              {t("form.submit")}
            </Button>
          </>
        }
      >
        <SectionCard
          group
          span={1}
          title={t("form.sections.payer.title")}
          description={t("form.sections.payer.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.clientId ? true : undefined}>
              <FieldLabel htmlFor="payment-client">{t("form.fields.client")}</FieldLabel>
              <Select value={clientId} onValueChange={changeClient}>
                <SelectTrigger
                  id="payment-client"
                  className="w-full"
                  aria-invalid={errors.clientId ? true : undefined}
                >
                  <SelectValue placeholder={t("form.fields.clientPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{fieldMessage(errors.clientId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.date ? true : undefined}>
              <FieldLabel htmlFor="payment-date">{t("form.fields.date")}</FieldLabel>
              <Controller
                control={form.control}
                name="date"
                render={({ field }) => (
                  <DateField
                    id="payment-date"
                    value={field.value}
                    max={today}
                    onChange={field.onChange}
                  />
                )}
              />
              <FieldError>{fieldMessage(errors.date?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.accountId ? true : undefined}>
              <FieldLabel htmlFor="payment-account">{t("form.fields.account")}</FieldLabel>
              <Select value={accountId} onValueChange={changeAccount}>
                <SelectTrigger
                  id="payment-account"
                  className="w-full"
                  aria-invalid={errors.accountId ? true : undefined}
                >
                  <SelectValue placeholder={t("form.fields.accountPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {`${item.name} (${item.currency})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{fieldMessage(errors.accountId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.methodId ? true : undefined}>
              <FieldLabel htmlFor="payment-method">{t("form.fields.method")}</FieldLabel>
              <Select
                value={methodId}
                onValueChange={(value) =>
                  form.setValue("methodId", value, { shouldValidate: true })
                }
              >
                <SelectTrigger
                  id="payment-method"
                  className="w-full"
                  aria-invalid={errors.methodId ? true : undefined}
                >
                  <SelectValue placeholder={t("form.fields.methodPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {catalogLabel(item, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{fieldMessage(errors.methodId?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.money.title")}
          description={t("form.sections.money.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.amount ? true : undefined}>
              <FieldLabel htmlFor="payment-amount">
                {t("form.fields.amount")} {currency ? `(${currency})` : null}
              </FieldLabel>
              <Input id="payment-amount" inputMode="decimal" {...form.register("amount")} />
              <FieldError>{fieldMessage(errors.amount?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.igtfAmount ? true : undefined}>
              <FieldLabel htmlFor="payment-igtf">{t("form.fields.igtf")}</FieldLabel>
              <Input
                id="payment-igtf"
                inputMode="decimal"
                {...form.register("igtfAmount", {
                  onChange: () => setIgtfEdited(true),
                })}
              />
              <FieldDescription>{t("form.fields.igtfHint")}</FieldDescription>
              <FieldError>{fieldMessage(errors.igtfAmount?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.feeAmount ? true : undefined}>
              <FieldLabel htmlFor="payment-fee">{t("form.fields.fee")}</FieldLabel>
              <Input id="payment-fee" inputMode="decimal" {...form.register("feeAmount")} />
              <FieldError>{fieldMessage(errors.feeAmount?.message)}</FieldError>
            </Field>
            {account && !isUsd ? (
              <Field data-invalid={errors.usdRate ? true : undefined}>
                <FieldLabel htmlFor="payment-usd-rate">
                  {t("form.fields.usdRate", { currency })}
                </FieldLabel>
                <Controller
                  control={form.control}
                  name="usdRate"
                  render={({ field }) => (
                    <RateInput
                      id="payment-usd-rate"
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
          </div>
          <dl className="mt-6 grid gap-3 text-sm @lg:grid-cols-3">
            <AmountLine
              label={t("form.fields.allocatable")}
              amount={amounts?.allocatable}
              currency={currency}
            />
            <AmountLine
              label={t("form.fields.netCredited")}
              amount={amounts?.netCredited}
              currency={currency}
            />
            <AmountLine
              label={t("form.fields.unallocated")}
              amount={amounts?.unallocated}
              currency={currency}
            />
          </dl>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.allocations.title")}
          description={t("form.sections.allocations.description")}
        >
          <AllocationsSection
            openInvoices={openInvoices}
            clientSelected={clientId !== ""}
            applied={applied}
            currency={currency}
            usdRate={usdRate}
            onRowChange={setRow}
          />
        </SectionCard>

        <SectionCard group span={1} title={t("form.sections.reference.title")}>
          {duplicates.length > 0 ? (
            <Alert className="mb-4">
              <AlertTitle>{t("form.duplicate.title")}</AlertTitle>
              <AlertDescription>
                {t("form.duplicate.description", {
                  codes: duplicates.map((match) => match.payment.label).join(", "),
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <Field data-invalid={errors.reference ? true : undefined}>
              <FieldLabel htmlFor="payment-reference">{t("form.fields.reference")}</FieldLabel>
              <Input id="payment-reference" {...form.register("reference")} />
              <FieldDescription>
                {requiresReference ? t("form.hints.referenceRequired") : null}
              </FieldDescription>
              <FieldError>{fieldMessage(errors.reference?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.receiptFileId ? true : undefined}>
              <FieldLabel htmlFor="payment-receipt">{t("form.fields.receipt")}</FieldLabel>
              <Uploader
                id="payment-receipt"
                adapter={uploadAdapter}
                context="payment_receipt"
                multiple={false}
                aria-label={t("form.ariaReceipt")}
                onChange={(files) =>
                  form.setValue("receiptFileId", files[0]?.id ?? undefined, {
                    shouldValidate: true,
                  })
                }
              />
              <FieldDescription>{t("form.receiptHint")}</FieldDescription>
              <FieldError>{fieldMessage(errors.receiptFileId?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>
      </FormPage>
    </form>
  );
}

function AmountLine({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: MoneyString | undefined;
  currency: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        {amount !== undefined && currency !== "" ? (
          <MoneyText amount={amount} currency={currency} />
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}

function AllocationsSection({
  openInvoices,
  clientSelected,
  applied,
  currency,
  usdRate,
  onRowChange,
}: {
  openInvoices: OpenInvoiceOption[];
  clientSelected: boolean;
  applied: Record<string, AppliedRow>;
  currency: string;
  usdRate: string;
  onRowChange: (invoiceId: string, patch: Partial<AppliedRow>) => void;
}) {
  const t = useTranslations("payments.form");

  if (!clientSelected) {
    return <p className="text-sm text-muted-foreground">{t("fields.noClient")}</p>;
  }
  if (openInvoices.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("fields.noOpenInvoices")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {openInvoices.map((invoice) => {
        const row = applied[invoice.id];
        const selected = row?.selected ?? false;
        const proposal = row?.amountPayment
          ? proposeInvoiceAmount(row.amountPayment, currency, usdRate, invoice)
          : null;
        return (
          <div
            key={invoice.id}
            className="grid items-center gap-3 rounded-xl border p-3 text-sm @lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <label className="flex items-center gap-3">
              <Checkbox
                checked={selected}
                onCheckedChange={(value) => onRowChange(invoice.id, { selected: value === true })}
                aria-label={invoice.code}
              />
              <span className="flex flex-col">
                <span className="font-medium">{invoice.code}</span>
                <span className="text-xs text-muted-foreground">{invoice.invoiceNumber}</span>
              </span>
            </label>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{t("fields.balanceHeader")}</span>
              <MoneyText amount={invoice.balance} currency={invoice.currency} />
            </div>
            <Field>
              <FieldLabel htmlFor={`payment-alloc-${invoice.id}`}>
                {t("fields.amountHeader", { currency })}
              </FieldLabel>
              <Input
                id={`payment-alloc-${invoice.id}`}
                inputMode="decimal"
                disabled={!selected}
                value={row?.amountPayment ?? ""}
                onChange={(event) =>
                  onRowChange(invoice.id, {
                    amountPayment: event.target.value,
                    invoiceAmount: undefined,
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`payment-alloc-inv-${invoice.id}`}>
                {t("fields.invoiceCurrencyHeader", { currency: invoice.currency })}
              </FieldLabel>
              <Input
                id={`payment-alloc-inv-${invoice.id}`}
                inputMode="decimal"
                disabled={!selected}
                value={row?.invoiceAmount ?? proposal ?? ""}
                onChange={(event) => onRowChange(invoice.id, { invoiceAmount: event.target.value })}
              />
              <FieldDescription>{t("fields.proposedHint")}</FieldDescription>
            </Field>
          </div>
        );
      })}
    </div>
  );
}
