"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { FormPage } from "@/components/patterns/form-page";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import { TagPicker } from "@/features/tags/components/tag-picker";
import type { EntityRef } from "@/lib/validators/common";
import type {
  DocumentCategoryDetailDTO,
  DocumentTypeCapabilities,
} from "@/lib/validators/document-types";
import {
  DEFAULT_ALERT_DAYS_BEFORE,
  createDocumentInputSchemaFor,
  updateDocumentMetaInputSchemaFor,
  type CreateDocumentFormValues,
  type DocumentDetailDTO,
  type DocumentLinkEntityType,
  type UpdateDocumentMetaFormValues,
} from "@/lib/validators/documents";
import type { TagChipDTO } from "@/lib/validators/tags";
import { createDocumentAction, updateDocumentMetaAction } from "../actions";

const FORM_ID = "document-form";

/** Fields the server may answer `fieldErrors` for. */
const FIELDS = [
  "title",
  "typeId",
  "summary",
  "effectiveDate",
  "signedAt",
  "expiresAt",
  "alertDaysBefore",
] as const;
type FormField = (typeof FIELDS)[number];

type FormValues = {
  title: string;
  typeId: string;
  summary: string;
  effectiveDate?: string;
  signedAt?: string;
  expiresAt?: string;
  alertDaysBefore: number;
  tagIds: string[];
};

const NO_TYPE_RULES: DocumentTypeCapabilities = { requiresSignature: false, hasExpiration: false };

type DocumentFormProps = {
  /** Categories with their types, from `listDocumentCategories`; the type picker groups them. */
  categories: readonly DocumentCategoryDetailDTO[];
  /** The document being edited; absent on `/documents/new`. */
  document?: DocumentDetailDTO;
  /** Records a new document is linked to, prefilled from `?entityType=&entityId=` (client or project). */
  initialLinks?: readonly EntityRef[];
  canCreateTags: boolean;
};

/**
 * `/documents/new` and `/documents/[id]/edit` (PRD §8.9): the document's metadata. The selected type decides the
 * fields: the signature date only on types with signature, the expiry date and its alert days only on types with
 * expiration (`createDocumentInputSchemaFor` / `updateDocumentMetaInputSchemaFor`, checked again by the service).
 * A new document starts as `BORRADOR`, linked to the prefilled records; a markdown one opens in the editor, any
 * other in its detail to add the file or the link.
 */
export function DocumentForm({
  categories,
  document,
  initialLinks = [],
  canCreateTags,
}: DocumentFormProps) {
  const t = useTranslations("documents");
  const tRoot = useTranslations();
  const tActions = useTranslations("common.actions");
  const locale = useLocale();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<readonly EntityRef[]>(initialLinks);
  const [tagChips, setTagChips] = useState<TagChipDTO[]>(document?.tags ?? []);
  const isEdit = document !== undefined;

  const types = categories.flatMap((category) => category.types);
  /** Rules of the chosen type: the catalog's, or the edited document's own type when the catalog lacks it. */
  const rulesOf = (id: string): DocumentTypeCapabilities => {
    const type =
      types.find((item) => item.id === id) ??
      (document?.type.id === id ? document.type : undefined);
    return type ? capabilitiesOf(type) : NO_TYPE_RULES;
  };

  const form = useForm<FormValues>({
    resolver: ((values, context, options) => {
      const rules = rulesOf(values.typeId);
      const payload = toPayload(values, rules);
      const schema = document
        ? updateDocumentMetaInputSchemaFor(rules)
        : createDocumentInputSchemaFor(rules);
      const input = document
        ? ({ ...payload, id: document.id } satisfies UpdateDocumentMetaFormValues)
        : // The links are checked by the action and the service; the form never makes them invalid.
          (payload satisfies CreateDocumentFormValues);
      return zodResolver(schema)(input, context, options as never);
    }) as Resolver<FormValues>,
    defaultValues: {
      title: document?.title ?? "",
      typeId: document?.type.id ?? "",
      summary: document?.summary ?? "",
      effectiveDate: document?.effectiveDate ?? undefined,
      signedAt: document?.signedAt ?? undefined,
      expiresAt: document?.expiresAt ?? undefined,
      alertDaysBefore: document?.alertDaysBefore ?? DEFAULT_ALERT_DAYS_BEFORE,
      tagIds: document?.tags.map((tag) => tag.id) ?? [],
    },
  });
  const errors = form.formState.errors;
  const typeId = useWatch({ control: form.control, name: "typeId" });
  const selectedType =
    types.find((type) => type.id === typeId) ??
    (document?.type.id === typeId ? document.type : undefined);
  const caps = rulesOf(typeId);

  const fieldMessage = (message: string | undefined) =>
    message ? (tRoot.has(message) ? tRoot(message as never) : message) : undefined;

  function pickType(value: string) {
    const rules = rulesOf(value);
    // Dates the new type does not take are cleared, so they are never sent.
    if (!rules.requiresSignature) form.setValue("signedAt", undefined);
    if (!rules.hasExpiration) form.setValue("expiresAt", undefined);
    form.setValue("typeId", value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  }

  async function onSubmit(values: FormValues) {
    setSaving(true);
    const payload = toPayload(values, rulesOf(values.typeId));
    const result = document
      ? await updateDocumentMetaAction({ ...payload, id: document.id })
      : await createDocumentAction({ ...payload, links: linkTargets(links) });
    setSaving(false);
    if (!result.ok) {
      let onFields = false;
      for (const [name, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        if ((FIELDS as readonly string[]).includes(name) && messages[0]) {
          form.setError(name as FormField, { message: messages[0] });
          onFields = true;
        }
      }
      if (!onFields) toast.error(fieldMessage(result.error.message) ?? t("form.failed"));
      return;
    }
    toast.success(isEdit ? t("form.updated") : t("form.created"));
    const opensEditor = !isEdit && selectedType?.defaultFormat === "MARKDOWN";
    router.push(`/documents/${result.data.id}${opensEditor ? "/editor" : ""}`);
  }

  const backHref = document ? `/documents/${document.id}` : "/documents/list";

  return (
    <form id={FORM_ID} noValidate onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}>
      <FormPage
        title={isEdit ? t("page.editTitle") : t("page.newTitle")}
        description={isEdit ? t("form.editDescription") : t("form.createDescription")}
        backHref={backHref}
        dirty={form.formState.isDirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href={backHref}>{tActions("cancel")}</Link>
            </Button>
            <Button type="submit" form={FORM_ID} disabled={saving}>
              {isEdit ? t("form.submit.edit") : t("form.submit.create")}
            </Button>
          </>
        }
      >
        <SectionCard
          group
          span={1}
          title={t("form.sections.general.title")}
          description={t("form.sections.general.description")}
        >
          <Field data-invalid={errors.title ? true : undefined}>
            <FieldLabel htmlFor="document-title">{t("form.fields.title")}</FieldLabel>
            <Input
              id="document-title"
              placeholder={t("form.placeholders.title")}
              aria-invalid={errors.title ? true : undefined}
              {...form.register("title")}
            />
            <FieldError>{fieldMessage(errors.title?.message)}</FieldError>
          </Field>
          <Field data-invalid={errors.typeId ? true : undefined}>
            <FieldLabel htmlFor="document-type">{t("form.fields.type")}</FieldLabel>
            <Select value={typeId || undefined} onValueChange={pickType}>
              <SelectTrigger
                id="document-type"
                className="w-full"
                aria-invalid={errors.typeId ? true : undefined}
              >
                <SelectValue placeholder={t("form.placeholders.type")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => {
                  // Inactive types cannot be picked; the edited document keeps its own type.
                  const options = category.types.filter(
                    (type) => type.active || type.id === document?.type.id,
                  );
                  if (options.length === 0) return null;
                  return (
                    <SelectGroup key={category.id}>
                      <SelectLabel>{catalogLabel(category, locale)}</SelectLabel>
                      {options.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {catalogLabel(type, locale)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
            <FieldDescription>{t("form.hints.type")}</FieldDescription>
            <FieldError>{fieldMessage(errors.typeId?.message)}</FieldError>
          </Field>
          <Field data-invalid={errors.summary ? true : undefined}>
            <FieldLabel htmlFor="document-summary">{t("form.fields.summary")}</FieldLabel>
            <Textarea
              id="document-summary"
              aria-invalid={errors.summary ? true : undefined}
              {...form.register("summary")}
            />
            <FieldError>{fieldMessage(errors.summary?.message)}</FieldError>
          </Field>
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.dates.title")}
          description={t("form.sections.dates.description")}
        >
          <div className="grid items-start gap-x-4 gap-y-5 @lg:grid-cols-2">
            <DateRow form={form} name="effectiveDate" label={t("form.fields.effectiveDate")} />
            {caps.requiresSignature ? (
              <DateRow form={form} name="signedAt" label={t("form.fields.signedAt")} />
            ) : null}
            {caps.hasExpiration ? (
              <>
                <DateRow form={form} name="expiresAt" label={t("form.fields.expiresAt")} />
                <Field data-invalid={errors.alertDaysBefore ? true : undefined}>
                  <FieldLabel htmlFor="document-alertDaysBefore">
                    {t("form.fields.alertDaysBefore")}
                  </FieldLabel>
                  <Input
                    id="document-alertDaysBefore"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={365}
                    aria-invalid={errors.alertDaysBefore ? true : undefined}
                    {...form.register("alertDaysBefore", { valueAsNumber: true })}
                  />
                  <FieldError>{fieldMessage(errors.alertDaysBefore?.message)}</FieldError>
                </Field>
              </>
            ) : null}
          </div>
          {selectedType && !caps.requiresSignature && !caps.hasExpiration ? (
            <p className="text-sm text-muted-foreground">{t("form.hints.noDates")}</p>
          ) : null}
        </SectionCard>

        <SectionCard
          group
          span={1}
          title={t("form.sections.classification.title")}
          description={t("form.sections.classification.description")}
        >
          <Field>
            <FieldLabel htmlFor="document-tags">{t("form.fields.tags")}</FieldLabel>
            <TagPicker
              id="document-tags"
              aria-label={t("form.fields.tags")}
              value={tagChips}
              canCreate={canCreateTags}
              onChange={(next) => {
                setTagChips(next);
                form.setValue(
                  "tagIds",
                  next.map((tag) => tag.id),
                  { shouldDirty: true },
                );
              }}
            />
          </Field>
        </SectionCard>

        {isEdit ? null : (
          <SectionCard
            group
            span={1}
            title={t("form.sections.links.title")}
            description={t("form.sections.links.description")}
          >
            {links.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("form.noLinks")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {links.map((ref) => (
                  <li
                    key={`${ref.type}:${ref.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md border py-0.5 ps-1 pe-0.5 text-sm"
                  >
                    {ref.code ? <EntityCodeChip code={ref.code} /> : null}
                    <span>{ref.label}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={t("form.removeLink", { label: ref.label })}
                      onClick={() =>
                        setLinks((current) =>
                          current.filter((item) => !(item.type === ref.type && item.id === ref.id)),
                        )
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </FormPage>
    </form>
  );
}

type DateName = "effectiveDate" | "signedAt" | "expiresAt";

/** A date of the form: empty means "not set", so the value stays `undefined` and the schema reads it as absent. */
function DateRow({
  form,
  name,
  label,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  name: DateName;
  label: string;
}) {
  const t = useTranslations();
  const message = form.formState.errors[name]?.message;
  const id = `document-${name}`;
  return (
    <Field data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <DateField
            id={id}
            value={field.value ?? ""}
            onChange={(value) => field.onChange(value || undefined)}
            placeholder={t("documents.form.placeholders.date")}
            aria-invalid={message ? true : undefined}
          />
        )}
      />
      <FieldError>
        {message ? (t.has(message) ? t(message as never) : message) : undefined}
      </FieldError>
    </Field>
  );
}

function capabilitiesOf(type: DocumentTypeCapabilities): DocumentTypeCapabilities {
  return { requiresSignature: type.requiresSignature, hasExpiration: type.hasExpiration };
}

/** The metadata the actions take: dates the type does not allow are left out. */
function toPayload(values: FormValues, caps: DocumentTypeCapabilities) {
  return {
    title: values.title,
    typeId: values.typeId,
    summary: values.summary,
    effectiveDate: values.effectiveDate || undefined,
    signedAt: caps.requiresSignature ? values.signedAt || undefined : undefined,
    expiresAt: caps.hasExpiration ? values.expiresAt || undefined : undefined,
    alertDaysBefore: Number.isFinite(values.alertDaysBefore)
      ? values.alertDaysBefore
      : DEFAULT_ALERT_DAYS_BEFORE,
    tagIds: values.tagIds,
  };
}

function linkTargets(links: readonly EntityRef[]) {
  return links.map((ref) => ({
    entityType: ref.type as DocumentLinkEntityType,
    entityId: ref.id,
  }));
}
