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
import { ClientPicker, type ClientPickerValue } from "@/features/clients/components/client-picker";
import { lookupRateAction } from "@/features/catalogs/actions";
import { uploadAdapter } from "@/features/files/upload-adapter";
import {
  createPaymentAction,
  detectDuplicatePaymentAction,
  listOpenInvoicesAction,
  updatePaymentAction,
} from "@/features/payments/actions";
import type { OpenInvoiceOption } from "@/features/payments/types";
import type { DateOnly } from "@/lib/dates";
import { computePaymentAmounts, proposeIgtfAmount } from "@/lib/finance";
import { compareMoney, isDecimalString, type MoneyString } from "@/lib/money";
import type {
  CreatePaymentDto,
  DuplicatePaymentResponseDto,
  PaymentResponseDto,
} from "@/lib/api/types/payments";
import type { ActionError } from "@/lib/validators/common";
import { fileDtoSchema } from "@/lib/validators/files";
import { createPaymentInputSchema } from "@/lib/validators/payments";
import {
  AllocationRows,
  isPositiveAmount,
  shownInvoiceAmount,
  type AppliedRow,
} from "./allocation-rows";

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
export type PaymentFormAccount = { id: string; name: string; currency: string; active?: boolean };
export type PaymentFormMethod = {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  requiresReference: boolean;
  suggestsIgtf: boolean;
  /** Absent means active; an inactive one is offered only when the edited payment already uses it (rule 23). */
  active?: boolean;
};

export type PaymentFormProps = {
  /** Active accounts only: a payment enters an active account. */
  accounts: PaymentFormAccount[];
  /** Active methods, with their reference and IGTF rules. */
  methods: PaymentFormMethod[];
  fiscal: { igtfRate: MoneyString; igtfCurrencies: string[] };
  /** Business "today" (America/Caracas), computed on the server. */
  today: DateOnly;
  /** Client preselected from `?invoiceId=` (named by the page), with its open invoices. */
  initialClient?: PaymentFormClient | null;
  initialOpenInvoices?: OpenInvoiceOption[];
  /** Invoice preselected by `?invoiceId=`: it is ticked, with its balance as the amount. */
  initialInvoiceId?: string;
  /**
   * Edit mode (Q-FEINT-11 (A), DT-213): the stored payment. The form patches it; allocations change only through
   * "Asignar" / "Desasignar" on the detail, so the "Aplicar a facturas" section is not shown.
   */
  payment?: PaymentResponseDto;
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

type PickerOption = { id: string; label: string; inactive: boolean };

/**
 * Options of a picker, plus the record's own value when the picker no longer offers it (rule 23): an inactive item
 * the edited payment already uses stays selectable, and a value missing from the list is shown from the payment's
 * own label. Both carry the "inactive" hint, and the value is sent unchanged unless the user picks another.
 */
function pickerOptions<T extends { id: string; active?: boolean }>(
  items: readonly T[],
  labelOf: (item: T) => string,
  stored: { id: string; label: string } | undefined,
): PickerOption[] {
  const options = items
    .filter((item) => item.active !== false || item.id === stored?.id)
    .map((item) => ({ id: item.id, label: labelOf(item), inactive: item.active === false }));
  if (stored && !items.some((item) => item.id === stored.id)) {
    options.push({ id: stored.id, label: stored.label, inactive: true });
  }
  return options;
}

/**
 * Payment form (HU-13, HU-14). The fields of the contract are required (CA1), the reference when the method asks
 * for it. IGTF is proposed from the fiscal settings (DT-70) and stays editable. The unallocated rest is credit
 * (CA5). Possible duplicates are shown as a warning, never as a refusal (CA6). With `payment` it edits that payment
 * (DT-213) without the allocations section.
 */
export function PaymentForm({
  accounts,
  methods,
  fiscal,
  today,
  initialClient = null,
  initialOpenInvoices = [],
  initialInvoiceId,
  payment,
}: PaymentFormProps) {
  const t = useTranslations("payments");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const locale = useLocale();
  const router = useRouter();
  const editing = payment !== undefined;
  const [saving, setSaving] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceOption[]>(initialOpenInvoices);
  const [igtfEdited, setIgtfEdited] = useState(editing);
  const [client, setClient] = useState<ClientPickerValue | null>(
    payment ? { id: payment.client.id, name: payment.client.label } : initialClient,
  );
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [allocationsError, setAllocationsError] = useState<string | undefined>();
  const [duplicateResult, setDuplicateResult] = useState<{
    key: string;
    matches: DuplicatePaymentResponseDto["matches"];
  }>({ key: "", matches: [] });

  const initialAccount = payment
    ? accounts.find((account) => account.id === payment.account.id)
    : (accounts.find((account) => account.currency === "USD") ?? accounts[0]);
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
    defaultValues: payment
      ? {
          clientId: payment.client.id,
          date: payment.date,
          accountId: payment.account.id,
          methodId: payment.method.id,
          currency: payment.currency,
          amount: payment.amount,
          igtfAmount: payment.igtfAmount,
          feeAmount: payment.feeAmount,
          usdRate: payment.usdRate,
          reference: payment.reference ?? "",
          receiptFileId: payment.receiptFileId ?? undefined,
        }
      : {
          clientId: initialClient?.id ?? "",
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

  const hint = ` · ${t("form.inactiveHint")}`;
  const accountOptions = pickerOptions(
    accounts,
    (item) => `${item.name} (${item.currency})`,
    payment
      ? { id: payment.account.id, label: `${payment.account.label} (${payment.currency})` }
      : undefined,
  );
  const methodOptions = pickerOptions(
    methods,
    (item) => catalogLabel(item, locale),
    payment ? { id: payment.method.id, label: catalogLabel(payment.method, locale) } : undefined,
  );
  const methodOf = (id: string) => methods.find((item) => item.id === id);
  // Client and account stay put while the payment has live allocations (cosmetic: the BE keeps `INTEGRITY_LOCK`).
  const locked = (payment?.allocations.length ?? 0) > 0;

  const account = accounts.find((item) => item.id === accountId);
  const currency = account?.currency ?? payment?.currency ?? "";
  const method = methodOf(methodId);
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

  // Possible duplicate (CA6): the same reference, method and account. A warning only, looked up after a pause. The
  // edited payment is excluded so it does not match itself.
  const duplicateKey =
    methodId && accountId && reference.trim() !== ""
      ? `${methodId}|${accountId}|${reference.trim()}`
      : "";
  const editedId = payment?.id;
  useEffect(() => {
    if (!duplicateKey) return;
    const timer = setTimeout(() => {
      void detectDuplicatePaymentAction({
        methodId,
        accountId,
        reference: reference.trim(),
        ...(editedId ? { excludePaymentId: editedId } : {}),
      }).then((result) => {
        setDuplicateResult({ key: duplicateKey, matches: result.ok ? result.data.matches : [] });
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [duplicateKey, methodId, accountId, reference, editedId]);
  const duplicates = duplicateResult.key === duplicateKey ? duplicateResult.matches : [];

  // Amounts shown live (lib/finance, C17): allocatable, net credited and the credit left on this payment. A
  // display-only preview: the saved figures come from the BE response.
  const amounts = useMemo(() => {
    const validAmount = isDecimalString(amount) ? amount : "0";
    const validIgtf = isDecimalString(igtfAmount) ? igtfAmount : "0";
    const validFee = isDecimalString(feeAmount) ? feeAmount : "0";
    const allocated = editing
      ? (payment?.allocations ?? []).map((row) => row.amountPaymentCurrency)
      : Object.values(applied)
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
  }, [amount, igtfAmount, feeAmount, applied, editing, payment]);

  async function changeClient(next: ClientPickerValue | null) {
    setClient(next);
    const nextClientId = next?.id ?? "";
    form.setValue("clientId", nextClientId, { shouldValidate: true });
    if (editing) return;
    setApplied({});
    setRowErrors({});
    if (!nextClientId) {
      setOpenInvoices([]);
      return;
    }
    const result = await listOpenInvoicesAction({ clientId: nextClientId });
    setOpenInvoices(result.ok ? result.data : []);
  }

  function changeAccount(nextAccountId: string) {
    const next = accounts.find((item) => item.id === nextAccountId);
    form.setValue("accountId", nextAccountId, { shouldValidate: true });
    form.setValue("currency", next?.currency ?? "");
    form.setValue("usdRate", next?.currency === "USD" ? "1" : "");
  }

  function setRow(invoiceId: string, patch: Partial<AppliedRow>) {
    setRowErrors((current) => {
      const next = { ...current };
      delete next[invoiceId];
      return next;
    });
    setAllocationsError(undefined);
    setApplied((current) => ({
      ...current,
      [invoiceId]: { selected: false, amountPayment: "", ...current[invoiceId], ...patch },
    }));
  }

  async function lookupRate(lookupDate: string, rateCurrency: string) {
    const result = await lookupRateAction({ date: lookupDate, currency: rateCurrency });
    return result.ok && result.data ? (result.data as RateLookupResult) : null;
  }

  /**
   * The ticked allocations, with both amounts exactly as the fields show them (rule 22): the payment-currency amount
   * as typed and the invoice-currency amount as shown, edited or proposed. A row with nothing valid to send is
   * flagged instead of being completed with a hidden value.
   */
  function buildAllocations() {
    const allocations: CreatePaymentDto["allocations"] = [];
    const missing: Record<string, string> = {};
    for (const invoice of openInvoices) {
      const row = applied[invoice.id];
      if (!row?.selected) continue;
      const shown = shownInvoiceAmount(row, invoice, currency, usdRate);
      if (!isPositiveAmount(row.amountPayment) || !isPositiveAmount(shown)) {
        missing[invoice.id] = "payments.validation.allocationAmountRequired";
        continue;
      }
      allocations.push({
        invoiceId: invoice.id,
        amountPaymentCurrency: row.amountPayment,
        amountInvoiceCurrency: shown,
      });
    }
    return { allocations, missing };
  }

  /** The BE's refusal: each field error at its path (a row of "Aplicar a facturas", the section, a field). */
  function showError(error: ActionError, submittedInvoiceIds: readonly string[]) {
    const nextRowErrors: Record<string, string> = {};
    for (const [path, messages] of Object.entries(error.fieldErrors ?? {})) {
      const message = messages[0];
      if (!message) continue;
      const [root = "", index, ...rest] = path.split(".");
      if (root === "allocations" && index === undefined) {
        setAllocationsError(message);
      } else if (root === "allocations") {
        const invoiceId = submittedInvoiceIds[Number(index)];
        if (invoiceId && rest.length > 0) nextRowErrors[invoiceId] = message;
      } else if ((FIELD_NAMES as readonly string[]).includes(root)) {
        form.setError(root as (typeof FIELD_NAMES)[number], { message });
      }
    }
    setRowErrors(nextRowErrors);
    toast.error(error.message ? tRoot(error.message as never) : tErrors(error.code));
  }

  async function onSubmit(values: PaymentFormValues) {
    // The reference rule follows the method (HU-13 CA1); the server repeats it. The resolver output drops a blank
    // reference to `undefined`, so the check must not assume a string.
    if (requiresReference && !values.reference?.trim()) {
      form.setError("reference", { message: "payments.validation.referenceRequired" });
      return;
    }
    setAllocationsError(undefined);
    const fields = {
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
    };

    if (payment) {
      setSaving(true);
      const result = await updatePaymentAction({
        id: payment.id,
        ...fields,
        // Removing the stored receipt clears it; an untouched one is sent unchanged.
        receiptFileId: values.receiptFileId ?? null,
      });
      setSaving(false);
      if (!result.ok) {
        showError(result.error, []);
        return;
      }
      toast.success(t("toast.updated"));
      router.push(`/payments/${result.data.id}`);
      return;
    }

    const { allocations, missing } = buildAllocations();
    if (Object.keys(missing).length > 0) {
      setRowErrors(missing);
      toast.error(tErrors("VALIDATION"));
      return;
    }
    setRowErrors({});

    setSaving(true);
    const result = await createPaymentAction({
      ...fields,
      receiptFileId: values.receiptFileId || undefined,
      status: "CONFIRMADO",
      allocations,
    });
    setSaving(false);

    if (!result.ok) {
      showError(
        result.error,
        allocations.map((allocation) => allocation.invoiceId),
      );
      return;
    }

    toast.success(t("toast.created"));
    router.push(`/payments/${result.data.id}`);
  }

  const receiptFile = payment?.receipt ? fileDtoSchema.safeParse(payment.receipt) : undefined;

  return (
    <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormPage
        title={editing ? t("form.editTitle") : t("form.title")}
        description={editing ? t("form.editDescription") : t("form.description")}
        backHref={payment ? `/payments/${payment.id}` : "/payments/list"}
        dirty={form.formState.isDirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href={payment ? `/payments/${payment.id}` : "/payments"}>
                {tActions("cancel")}
              </Link>
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              disabled={saving}
              className="transition-transform active:scale-[0.96]"
            >
              {editing ? t("form.save") : t("form.submit")}
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
              <ClientPicker
                id="payment-client"
                value={client}
                onChange={(next) => void changeClient(next)}
                disabled={locked}
                placeholder={t("form.fields.clientPlaceholder")}
                aria-invalid={errors.clientId ? true : undefined}
              />
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
              <Select value={accountId} onValueChange={changeAccount} disabled={locked}>
                <SelectTrigger
                  id="payment-account"
                  className="w-full"
                  aria-invalid={errors.accountId ? true : undefined}
                >
                  <SelectValue placeholder={t("form.fields.accountPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {accountOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label + (item.inactive ? hint : "")}
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
                  {methodOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label + (item.inactive ? hint : "")}
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
              <Input
                id="payment-amount"
                aria-invalid={errors.amount ? true : undefined}
                inputMode="decimal"
                className="tabular-nums"
                {...form.register("amount")}
              />
              <FieldError>{fieldMessage(errors.amount?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.igtfAmount ? true : undefined}>
              <FieldLabel htmlFor="payment-igtf">{t("form.fields.igtf")}</FieldLabel>
              <Input
                id="payment-igtf"
                inputMode="decimal"
                className="tabular-nums"
                {...form.register("igtfAmount", {
                  onChange: () => setIgtfEdited(true),
                })}
              />
              <FieldDescription>{t("form.fields.igtfHint")}</FieldDescription>
              <FieldError>{fieldMessage(errors.igtfAmount?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.feeAmount ? true : undefined}>
              <FieldLabel htmlFor="payment-fee">{t("form.fields.fee")}</FieldLabel>
              <Input
                id="payment-fee"
                inputMode="decimal"
                className="tabular-nums"
                {...form.register("feeAmount")}
              />
              <FieldError>{fieldMessage(errors.feeAmount?.message)}</FieldError>
            </Field>
            {currency !== "" && !isUsd ? (
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
                      prefillOnMount={!editing}
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

        {editing ? null : (
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
              errors={rowErrors}
              sectionError={allocationsError}
              onRowChange={setRow}
            />
          </SectionCard>
        )}

        <SectionCard group span={1} title={t("form.sections.reference.title")}>
          {duplicates.length > 0 ? (
            <Alert className="mb-4 duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95">
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
                {...(receiptFile?.success ? { defaultFiles: [receiptFile.data] } : {})}
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
      <dd className="tabular-nums">
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
  errors,
  sectionError,
  onRowChange,
}: {
  openInvoices: OpenInvoiceOption[];
  clientSelected: boolean;
  applied: Record<string, AppliedRow>;
  currency: string;
  usdRate: string;
  errors: Record<string, string>;
  sectionError: string | undefined;
  onRowChange: (invoiceId: string, patch: Partial<AppliedRow>) => void;
}) {
  const t = useTranslations("payments.form");
  const tRoot = useTranslations();

  if (!clientSelected) {
    return <p className="text-sm text-muted-foreground">{t("fields.noClient")}</p>;
  }
  if (openInvoices.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("fields.noOpenInvoices")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <AllocationRows
        openInvoices={openInvoices}
        applied={applied}
        currency={currency}
        usdRate={usdRate}
        errors={errors}
        onRowChange={onRowChange}
      />
      {sectionError ? (
        <p role="alert" className="text-sm text-destructive">
          {tRoot(sectionError as never)}
        </p>
      ) : null}
    </div>
  );
}
