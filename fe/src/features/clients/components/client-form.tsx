"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { Button } from "@/components/ui/button";
import { CountryCombobox } from "@/components/ui/country-combobox/country-combobox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TagPicker } from "@/features/tags/components/tag-picker";
import { createClientAction, updateClientAction } from "@/features/clients/actions";
import { entityHref } from "@/lib/entity-routes";
import { CLIENT_KIND_VALUES, CLIENT_STATUS_VALUES } from "@/lib/validators/enums";
import {
  createClientInputSchema,
  updateClientInputSchema,
  type CountryCode,
  type CreateClientFormValues,
  type UpdateClientFormValues,
} from "@/lib/validators/clients";
import type { ClientDetailDTO } from "@/lib/validators/clients";
import type { EntityRef } from "@/lib/validators/common";
import type { TagChipDTO } from "@/lib/validators/tags";

const FORM_ID = "client-form";

/** The fields a client edit form starts from (the detail DTO without its metrics and contacts). */
export type ClientFormSource = Pick<
  ClientDetailDTO,
  | "id"
  | "code"
  | "kind"
  | "tradeName"
  | "legalName"
  | "taxId"
  | "country"
  | "address"
  | "phone"
  | "email"
  | "website"
  | "status"
  | "tags"
>;

type ClientFormValues = CreateClientFormValues & { id?: string };

type ClientFormProps = {
  /** Present on `/clients/[id]/edit`; absent on `/clients/new`. */
  client?: ClientFormSource;
  /** Inline "Crear" in the tag picker, computed on the server (R13). */
  canCreateTags: boolean;
};

const FIELD_NAMES = [
  "kind",
  "tradeName",
  "legalName",
  "taxId",
  "country",
  "address",
  "phone",
  "email",
  "website",
  "status",
  "tagIds",
] as const;

/**
 * Create and edit form of a client (`FormPage`). The same schemas as the actions resolve the form (C8), so
 * a field error is shown on the field before the action is called; server `fieldErrors` map back onto the
 * fields, and a `CONFLICT` on the tax id links to the record that holds it (HU-03 CA3).
 */
export function ClientForm({ client, canCreateTags }: ClientFormProps) {
  const t = useTranslations("clients");
  const tRoot = useTranslations();
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [tags, setTags] = useState<TagChipDTO[]>(client?.tags ?? []);
  const [conflict, setConflict] = useState<EntityRef | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(client ? updateClientInputSchema : createClientInputSchema),
    defaultValues: client
      ? {
          id: client.id,
          kind: client.kind,
          tradeName: client.tradeName,
          legalName: client.legalName,
          taxId: client.taxId,
          country: client.country,
          address: client.address,
          phone: client.phone,
          email: client.email ?? "",
          website: client.website ?? "",
          status: client.status,
          tagIds: client.tags.map((tag) => tag.id),
        }
      : {
          kind: "PERSONA",
          tradeName: "",
          legalName: "",
          taxId: "",
          country: "VE",
          address: "",
          phone: "",
          email: "",
          website: "",
          status: "PROSPECTO",
          tagIds: [],
        },
  });

  const kind = useWatch({ control: form.control, name: "kind" });
  const country = useWatch({ control: form.control, name: "country" });
  const status = useWatch({ control: form.control, name: "status" });
  const phone = useWatch({ control: form.control, name: "phone" });
  const errors = form.formState.errors;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;

  async function onSubmit(values: ClientFormValues) {
    setSaving(true);
    const result = client
      ? await updateClientAction({ ...(values as UpdateClientFormValues), id: client.id })
      : await createClientAction(values as CreateClientFormValues);
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
      if (error.code === "CONFLICT" && error.entity) {
        setConflict(error.entity);
        form.setError("taxId", { type: "conflict", message: tRoot(error.message as never) });
        return;
      }
      toast.error(tErrors(error.code));
      return;
    }

    toast.success(client ? t("toast.updated") : t("toast.created"));
    // The form is saved: clear the dirty state so the unsaved-changes guard does not block the navigation.
    form.reset(form.getValues());
    router.push(`/clients/${result.data.id}`);
  }

  const conflictHref = conflict ? entityHref({ type: conflict.type, id: conflict.id }) : null;
  const taxIdHint = country === "VE" ? t("form.fields.taxIdHintVe") : t("form.fields.taxIdHint");
  const backHref = client ? `/clients/${client.id}` : "/clients/list";

  return (
    <FormPage
      title={client ? t("form.editTitle") : t("form.createTitle")}
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
      <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">

        <section className="grid gap-4 md:grid-cols-2">
          <Field data-invalid={errors.kind ? true : undefined}>
            <FieldLabel htmlFor="client-kind">{t("form.fields.kind")}</FieldLabel>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="client-kind"
                    aria-label={t("form.kindOptions")}
                    aria-invalid={errors.kind ? true : undefined}
                    aria-describedby={errors.kind ? "client-kind-error" : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLIENT_KIND_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {tEnums(`ClientKind.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError id="client-kind-error">{fieldMessage(errors.kind?.message)}</FieldError>
          </Field>

          <Field data-invalid={errors.tradeName ? true : undefined}>
            <FieldLabel htmlFor="client-trade-name">{t("form.fields.tradeName")}</FieldLabel>
            <Input
              id="client-trade-name"
              aria-invalid={errors.tradeName ? true : undefined}
              aria-describedby={errors.tradeName ? "client-trade-name-error" : undefined}
              {...form.register("tradeName")}
            />
            <FieldError id="client-trade-name-error">
              {fieldMessage(errors.tradeName?.message)}
            </FieldError>
          </Field>

          <Field data-invalid={errors.legalName ? true : undefined}>
            <FieldLabel htmlFor="client-legal-name">{t("form.fields.legalName")}</FieldLabel>
            <Input
              id="client-legal-name"
              aria-required={kind === "EMPRESA" ? true : undefined}
              aria-invalid={errors.legalName ? true : undefined}
              aria-describedby={
                errors.legalName
                  ? ["client-legal-name-hint", "client-legal-name-error"].join(" ")
                  : "client-legal-name-hint"
              }
              {...form.register("legalName")}
            />
            <FieldDescription id="client-legal-name-hint">
              {t("form.fields.legalNameHint")}
            </FieldDescription>
            <FieldError id="client-legal-name-error">
              {fieldMessage(errors.legalName?.message)}
            </FieldError>
          </Field>

          <Field data-invalid={errors.taxId ? true : undefined}>
            <FieldLabel htmlFor="client-tax-id">{t("form.fields.taxId")}</FieldLabel>
            <Input
              id="client-tax-id"

              aria-invalid={errors.taxId ? true : undefined}
              aria-describedby={
                errors.taxId
                  ? ["client-tax-id-hint", "client-tax-id-error"].join(" ")
                  : "client-tax-id-hint"
              }
              {...form.register("taxId")}
            />
            <FieldDescription id="client-tax-id-hint">{taxIdHint}</FieldDescription>
            <FieldError id="client-tax-id-error">{fieldMessage(errors.taxId?.message)}</FieldError>
            {conflict && conflictHref ? (
              <Link
                href={conflictHref}
                className="text-sm font-medium underline underline-offset-4"
              >
                {t("form.conflictOpen", { code: conflict.code ?? conflict.label })}
              </Link>
            ) : null}
          </Field>

          <Field data-invalid={errors.country ? true : undefined}>
            <FieldLabel htmlFor="client-country">{t("form.fields.country")}</FieldLabel>
            <CountryCombobox
              id="client-country"
              value={country}
              aria-invalid={errors.country ? true : undefined}
              aria-describedby={errors.country ? "client-country-error" : undefined}
              onChange={(next) =>
                form.setValue("country", next as CountryCode, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
            <FieldError id="client-country-error">
              {fieldMessage(errors.country?.message)}
            </FieldError>
          </Field>

          <Field data-invalid={errors.address ? true : undefined} className="md:col-span-2">
            <FieldLabel htmlFor="client-address">{t("form.fields.address")}</FieldLabel>
            <Textarea
              id="client-address"
              rows={3}
              aria-invalid={errors.address ? true : undefined}
              aria-describedby={errors.address ? "client-address-error" : undefined}
              {...form.register("address")}
            />
            <FieldError id="client-address-error">
              {fieldMessage(errors.address?.message)}
            </FieldError>
          </Field>

          <Field data-invalid={errors.phone ? true : undefined}>
            <FieldLabel htmlFor="client-phone">{t("form.fields.phone")}</FieldLabel>
            <PhoneInput
              id="client-phone"
              defaultCountry="VE"
              value={phone ?? ""}
              aria-invalid={errors.phone ? true : undefined}
              onChange={(next) =>
                form.setValue("phone", next, { shouldDirty: true, shouldValidate: true })
              }
            />
            <FieldError id="client-phone-error">{fieldMessage(errors.phone?.message)}</FieldError>
          </Field>

          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="client-email">{t("form.fields.email")}</FieldLabel>
            <Input
              id="client-email"
              type="email"
              autoComplete="off"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "client-email-error" : undefined}
              {...form.register("email")}
            />
            <FieldError id="client-email-error">{fieldMessage(errors.email?.message)}</FieldError>
          </Field>

          <Field data-invalid={errors.website ? true : undefined}>
            <FieldLabel htmlFor="client-website">{t("form.fields.website")}</FieldLabel>
            <Input
              id="client-website"
              type="url"
              placeholder="https://"
              aria-invalid={errors.website ? true : undefined}
              aria-describedby={errors.website ? "client-website-error" : undefined}
              {...form.register("website")}
            />
            <FieldError id="client-website-error">
              {fieldMessage(errors.website?.message)}
            </FieldError>
          </Field>

          <Field data-invalid={errors.status ? true : undefined}>
            <FieldLabel htmlFor="client-status">{t("form.fields.status")}</FieldLabel>
            <Select
              value={status}
              onValueChange={(next) =>
                form.setValue("status", next as (typeof CLIENT_STATUS_VALUES)[number], {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger
                id="client-status"
                aria-label={t("form.statusOptions")}
                aria-invalid={errors.status ? true : undefined}
                aria-describedby={errors.status ? "client-status-error" : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_STATUS_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tEnums(`ClientStatus.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="client-status-error">{fieldMessage(errors.status?.message)}</FieldError>
          </Field>

          <Field className="md:col-span-2">
            <FieldLabel htmlFor="client-tags">{t("form.fields.tags")}</FieldLabel>
            <TagPicker
              id="client-tags"
              aria-label={t("form.fields.tags")}
              value={tags}
              canCreate={canCreateTags}
              onChange={(next) => {
                setTags(next);
                form.setValue(
                  "tagIds",
                  next.map((tag) => tag.id),
                  { shouldDirty: true },
                );
              }}
            />
          </Field>
        </section>
      </form>
    </FormPage>
  );
}
