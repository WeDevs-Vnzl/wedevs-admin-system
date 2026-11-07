"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiClient } from "@/lib/api/client";
import type { IssuedApiTokenDto } from "@/lib/api/types/api-tokens";
import { z } from "@/lib/validators/zod";
import {
  API_TOKEN_DEFAULT_DAYS,
  API_TOKEN_MAX_DAYS,
  API_TOKEN_MIN_DAYS,
  API_TOKEN_NAME_MAX_LENGTH,
  apiTokenMessageKey,
  issueApiToken,
} from "../api";

// UX validation only (PRD §7.4): the BE trims, bounds and re-validates, and its field errors land on the fields.
const createTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "validation.required")
    .max(API_TOKEN_NAME_MAX_LENGTH, "validation.tooLong"),
  expiresInDays: z
    .number({ error: "validation.required" })
    .int("apiTokens.errors.outOfRange")
    .min(API_TOKEN_MIN_DAYS, "apiTokens.errors.outOfRange")
    .max(API_TOKEN_MAX_DAYS, "apiTokens.errors.outOfRange"),
});
type CreateTokenValues = z.input<typeof createTokenSchema>;
type CreateTokenOutput = z.output<typeof createTokenSchema>;

type CreateTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the issued token, secret included: the parent shows it once and drops it. */
  onIssued: (issued: IssuedApiTokenDto) => void;
};

function CreateTokenForm({ onOpenChange, onIssued }: Omit<CreateTokenDialogProps, "open">) {
  const t = useTranslations("apiTokens");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const api = useApiClient();
  const form = useForm<CreateTokenValues, unknown, CreateTokenOutput>({
    resolver: zodResolver(createTokenSchema),
    defaultValues: { name: "", expiresInDays: API_TOKEN_DEFAULT_DAYS },
  });
  const { errors, isSubmitting } = form.formState;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: CreateTokenOutput) {
    const result = await issueApiToken(api, values);
    if (!result.ok) {
      const { code, fieldErrors, redirectTo } = result.error;
      if (redirectTo) router.push(redirectTo);
      let placed = false;
      for (const field of ["name", "expiresInDays"] as const) {
        const key = fieldErrors?.[field]?.[0];
        if (key) {
          form.setError(field, { message: apiTokenMessageKey(key, tRoot.has) });
          placed = true;
        }
      }
      if (!placed) {
        form.setError("root", {
          message: apiTokenMessageKey(result.error.message, tRoot.has, `common.errors.${code}`),
        });
      }
      if (code === "INTERNAL") toast.error(tErrors(code));
      return;
    }
    toast.success(t("toast.created"));
    onIssued(result.data);
    onOpenChange(false);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("form.title")}</DialogTitle>
        <DialogDescription>{t("form.description")}</DialogDescription>
      </DialogHeader>

      {errors.root?.message ? (
        <p role="alert" className="text-sm text-destructive">
          {message(errors.root.message)}
        </p>
      ) : null}

      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="api-token-name">{t("form.name")}</FieldLabel>
        <Input
          id="api-token-name"
          autoComplete="off"
          placeholder={t("form.namePlaceholder")}
          aria-invalid={errors.name ? true : undefined}
          {...form.register("name")}
        />
        <FieldError>{message(errors.name?.message)}</FieldError>
      </Field>

      <Field data-invalid={errors.expiresInDays ? true : undefined}>
        <FieldLabel htmlFor="api-token-days">{t("form.expiresInDays")}</FieldLabel>
        <Input
          id="api-token-days"
          type="number"
          inputMode="numeric"
          min={API_TOKEN_MIN_DAYS}
          max={API_TOKEN_MAX_DAYS}
          aria-describedby="api-token-days-hint"
          aria-invalid={errors.expiresInDays ? true : undefined}
          {...form.register("expiresInDays", { valueAsNumber: true })}
        />
        <FieldDescription id="api-token-days-hint">{t("form.expiresInDaysHint")}</FieldDescription>
        <FieldError>{message(errors.expiresInDays?.message)}</FieldError>
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("form.submitting") : t("form.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// The form unmounts with the dialog content, so every opening starts clean.
export function CreateTokenDialog({ open, onOpenChange, onIssued }: CreateTokenDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain">
        <CreateTokenForm onOpenChange={onOpenChange} onIssued={onIssued} />
      </DialogContent>
    </Dialog>
  );
}
