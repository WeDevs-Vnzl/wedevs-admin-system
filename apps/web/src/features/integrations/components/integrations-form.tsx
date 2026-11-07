"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiClient } from "@/lib/api/client";
import type {
  IntegrationMappingDto,
  UpdateIntegrationMappingDto,
} from "@/lib/api/types/integrations";
import { z } from "@/lib/validators/zod";
import { updateIntegrationMapping } from "../api";

/** An account the pickers offer; `currency` is shown next to the Stripe target (DT-183). */
export type MappingAccountOption = { id: string; name: string; currency: string };
export type MappingMethodOption = { id: string; label: string };

type IntegrationsFormProps = {
  initial: IntegrationMappingDto;
  /** Any active account (Stripe target). */
  accounts: readonly MappingAccountOption[];
  /** Active `WALLET_CRIPTO` accounts only (Binance wallet). */
  walletAccounts: readonly MappingAccountOption[];
  methods: readonly MappingMethodOption[];
};

// "Not mapped" has no value of its own in a Radix Select, so it travels as a sentinel and becomes `null`.
const NONE = "none";

// UX validation only: the BE re-validates the types and the grant, and its field errors land on the pickers.
const mappingSchema = z
  .object({
    stripeAccountId: z.string(),
    stripeMethodId: z.string(),
    binanceAccountId: z.string(),
  })
  .superRefine((value, ctx) => {
    if ((value.stripeAccountId === NONE) !== (value.stripeMethodId === NONE)) {
      ctx.addIssue({
        code: "custom",
        path: ["stripeMethodId"],
        message: "settings.integrations.errors.stripeIncomplete",
      });
    }
  });
type FormValues = z.input<typeof mappingSchema>;

const FIELD_OF_BE_PATH = {
  "stripe.accountId": "stripeAccountId",
  "stripe.paymentMethodId": "stripeMethodId",
  "binance.accountId": "binanceAccountId",
} as const;

function toFormValues(mapping: IntegrationMappingDto): FormValues {
  return {
    stripeAccountId: mapping.stripe?.accountId ?? NONE,
    stripeMethodId: mapping.stripe?.paymentMethodId ?? NONE,
    binanceAccountId: mapping.binance?.accountId ?? NONE,
  };
}

function toBody(values: FormValues): UpdateIntegrationMappingDto {
  return {
    stripe:
      values.stripeAccountId === NONE || values.stripeMethodId === NONE
        ? null
        : { accountId: values.stripeAccountId, paymentMethodId: values.stripeMethodId },
    binance: values.binanceAccountId === NONE ? null : { accountId: values.binanceAccountId },
  };
}

// Settings → Integraciones (DT-183, DT-184): which account and payment method Stripe money lands in, and which
// wallet account mirrors Binance. Owner and Admin (the `settings` grant); the BE decides.
export function IntegrationsForm({
  initial,
  accounts,
  walletAccounts,
  methods,
}: IntegrationsFormProps) {
  const t = useTranslations("settings.integrations");
  const tRoot = useTranslations();
  const router = useRouter();
  const api = useApiClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(mappingSchema),
    defaultValues: toFormValues(initial),
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);
  const stripeAccountId = useWatch({ control: form.control, name: "stripeAccountId" });
  const stripeCurrency = accounts.find((account) => account.id === stripeAccountId)?.currency;

  const accountLabel = (account: MappingAccountOption) =>
    t("accountOption", { name: account.name, currency: account.currency });

  async function onSubmit(values: FormValues) {
    const result = await updateIntegrationMapping(api, toBody(values));
    if (!result.ok) {
      const { code, fieldErrors, redirectTo } = result.error;
      if (redirectTo) router.push(redirectTo);
      let placed = false;
      for (const [path, field] of Object.entries(FIELD_OF_BE_PATH)) {
        const key = fieldErrors?.[path]?.[0];
        if (key) {
          form.setError(field, { message: tRoot.has(key) ? key : `common.errors.${code}` });
          placed = true;
        }
      }
      if (!placed) {
        form.setError("root", {
          message:
            code === "FORBIDDEN"
              ? "settings.integrations.errors.forbidden"
              : tRoot.has(result.error.message)
                ? result.error.message
                : `common.errors.${code}`,
        });
      }
      return;
    }
    // The saved mapping is re-rendered from the response, not from what was sent.
    form.reset(toFormValues(result.data));
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="flex max-w-3xl flex-col gap-6"
    >
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {errors.root?.message ? (
        <p role="alert" className="text-sm text-destructive">
          {message(errors.root.message)}
        </p>
      ) : null}

      <SectionCard title={t("stripe.title")} description={t("stripe.description")} group>
        <div className="grid gap-4 md:grid-cols-2">
          <Field data-invalid={errors.stripeAccountId ? true : undefined}>
            <FieldLabel htmlFor="integrations-stripe-account">{t("stripe.account")}</FieldLabel>
            <Controller
              control={form.control}
              name="stripeAccountId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="integrations-stripe-account"
                    className="w-full"
                    aria-invalid={errors.stripeAccountId ? true : undefined}
                  >
                    <SelectValue placeholder={t("stripe.accountPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("none")}</SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {accountLabel(account)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {stripeCurrency ? (
              <FieldDescription>
                {t("stripe.currency", { currency: stripeCurrency })}
              </FieldDescription>
            ) : null}
            <FieldError>{message(errors.stripeAccountId?.message)}</FieldError>
          </Field>

          <Field data-invalid={errors.stripeMethodId ? true : undefined}>
            <FieldLabel htmlFor="integrations-stripe-method">{t("stripe.method")}</FieldLabel>
            <Controller
              control={form.control}
              name="stripeMethodId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="integrations-stripe-method"
                    className="w-full"
                    aria-invalid={errors.stripeMethodId ? true : undefined}
                  >
                    <SelectValue placeholder={t("stripe.methodPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("none")}</SelectItem>
                    {methods.map((method) => (
                      <SelectItem key={method.id} value={method.id}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>{t("stripe.methodHint")}</FieldDescription>
            <FieldError>{message(errors.stripeMethodId?.message)}</FieldError>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title={t("binance.title")} description={t("binance.description")} group>
        <Field data-invalid={errors.binanceAccountId ? true : undefined}>
          <FieldLabel htmlFor="integrations-binance-account">{t("binance.account")}</FieldLabel>
          <Controller
            control={form.control}
            name="binanceAccountId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="integrations-binance-account"
                  className="w-full md:w-1/2"
                  aria-invalid={errors.binanceAccountId ? true : undefined}
                >
                  <SelectValue placeholder={t("binance.accountPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("none")}</SelectItem>
                  {walletAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {accountLabel(account)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {walletAccounts.length === 0 ? (
            <FieldDescription>{t("binance.noWallets")}</FieldDescription>
          ) : null}
          <FieldError>{message(errors.binanceAccountId?.message)}</FieldError>
        </Field>
      </SectionCard>

      <div className="flex justify-end">
        <Button
          type="submit"
          className="transition-transform active:scale-[0.96]"
          disabled={!isDirty || isSubmitting}
        >
          {isSubmitting ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
