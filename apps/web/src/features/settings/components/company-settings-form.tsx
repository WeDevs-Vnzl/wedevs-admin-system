"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Uploader } from "@/components/ui/uploader/uploader";
import { applyFieldErrors } from "@/features/catalogs/components/form-errors";
import { uploadAdapter } from "@/features/files/upload-adapter";
import { companySettingsSchema, type CompanySettings } from "@/lib/validators/settings";
import type { z } from "@/lib/validators/zod";
import { updateCompanySettingsAction } from "../actions";

type FormValues = z.input<typeof companySettingsSchema>;
type FormOutput = z.output<typeof companySettingsSchema>;

type CompanySettingsFormProps = {
  initial: CompanySettings;
};

const FIELDS = ["name", "legalName", "taxId", "address", "logoFileId"] as const;

function toFormValues(settings: CompanySettings): FormValues {
  return {
    name: settings.name,
    legalName: settings.legalName ?? "",
    taxId: settings.taxId ?? "",
    address: settings.address ?? "",
    logoFileId: settings.logoFileId ?? null,
  };
}

// Settings → Empresa (PRD §8.15): name, legal name, RIF, address and logo, used by the client portal and the
// print views. The logo goes through the same upload adapter as every other file (C23).
export function CompanySettingsForm({ initial }: CompanySettingsFormProps) {
  const t = useTranslations("settings.company");
  const tRoot = useTranslations();
  const router = useRouter();

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues: toFormValues(initial),
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);
  const logoFileId = useWatch({ control: form.control, name: "logoFileId" });
  const hasStoredLogo = Boolean(logoFileId) && logoFileId === initial.logoFileId;

  function setLogo(id: string | null) {
    form.setValue("logoFileId", id, { shouldDirty: true });
  }

  async function onSubmit(values: FormOutput) {
    const result = await updateCompanySettingsAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tRoot(result.error.message as never));
      return;
    }
    form.reset(toFormValues(result.data));
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormPage
        title={t("title")}
        description={t("description")}
        backHref="/settings"
        dirty={form.formState.isDirty}
        footer={
          <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
            {t("save")}
          </Button>
        }
      >
        <SectionCard title={t("profile.title")} span={2} group>
          <div className="grid gap-4 md:grid-cols-2">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="company-name">{t("name")}</FieldLabel>
              <Input
                id="company-name"
                autoComplete="organization"
                maxLength={120}
                aria-invalid={errors.name ? true : undefined}
                {...form.register("name")}
              />
              <FieldError>{message(errors.name?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.legalName ? true : undefined}>
              <FieldLabel htmlFor="company-legal-name">{t("legalName")}</FieldLabel>
              <Input
                id="company-legal-name"
                maxLength={160}
                aria-invalid={errors.legalName ? true : undefined}
                {...form.register("legalName")}
              />
              <FieldError>{message(errors.legalName?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.taxId ? true : undefined}>
              <FieldLabel htmlFor="company-tax-id">{t("taxId")}</FieldLabel>
              <Input
                id="company-tax-id"
                maxLength={30}
                aria-invalid={errors.taxId ? true : undefined}
                {...form.register("taxId")}
              />
              <FieldError>{message(errors.taxId?.message)}</FieldError>
            </Field>
            <Field data-invalid={errors.address ? true : undefined} className="md:col-span-2">
              <FieldLabel htmlFor="company-address">{t("address")}</FieldLabel>
              <Textarea
                id="company-address"
                rows={3}
                maxLength={300}
                aria-invalid={errors.address ? true : undefined}
                {...form.register("address")}
              />
              <FieldError>{message(errors.address?.message)}</FieldError>
            </Field>
          </div>
        </SectionCard>

        <SectionCard title={t("logo.label")} description={t("logo.description")} span={2} group>
          <Field data-invalid={errors.logoFileId ? true : undefined}>
            {hasStoredLogo ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldDescription>{t("logo.current")}</FieldDescription>
                <Button type="button" variant="outline" size="sm" onClick={() => setLogo(null)}>
                  {t("logo.remove")}
                </Button>
              </div>
            ) : logoFileId ? null : (
              <FieldDescription>{t("logo.none")}</FieldDescription>
            )}
            <Uploader
              adapter={uploadAdapter}
              context="general"
              multiple={false}
              onChange={(files) => setLogo(files[0]?.id ?? null)}
              disabled={form.formState.isSubmitting}
              aria-label={t("logo.uploadLabel")}
            />
            <FieldError>{message(errors.logoFileId?.message)}</FieldError>
          </Field>
        </SectionCard>
      </FormPage>
    </form>
  );
}
