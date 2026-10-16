"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
import { searchDocumentsAction } from "@/features/documents/actions";
import type { ActionResult } from "@/lib/validators/common";
import { LOCALE_VALUES } from "@/lib/validators/preferences";
import {
  createShareLinkInputSchema,
  type CreateShareLinkInput,
  type ShareDocumentInput,
} from "@/lib/validators/shares";
import type { z } from "@/lib/validators/zod";
import { getShareableDocumentAction } from "../actions";
import type { ShareableDocument } from "../types";

/** The link fields the form edits with react-hook-form; the documents are edited as rows. */
const linkFieldsSchema = createShareLinkInputSchema.omit({ documents: true, clientId: true });
type LinkFieldsValues = z.input<typeof linkFieldsSchema>;
type LinkFields = z.output<typeof linkFieldsSchema>;
const FORM_FIELDS = ["title", "message", "locale", "expiresAt", "allowDownload"] as const;
type FormField = (typeof FORM_FIELDS)[number];

/** Select value of "always the latest version" (`versionId: null`). */
const LATEST = "__latest__";

/** One document in the form: included or not, its version pin and whether it requires a key. */
export interface ShareFormRow {
  doc: ShareableDocument;
  included: boolean;
  versionId: string | null;
  requiresAccessKey: boolean;
}

/** A new row pins the current version by default (HU-22 CA6), or follows the latest when there is none yet. */
export function newShareFormRow(doc: ShareableDocument, included = true): ShareFormRow {
  return { doc, included, versionId: doc.currentVersionId, requiresAccessKey: false };
}

interface ShareFormProps {
  /** Prefix of the field ids, unique per form on the page. */
  idPrefix: string;
  defaults: LinkFieldsValues;
  /** Client of the link (personalizes the portal header); kept as is. */
  clientId?: string;
  initialRows: ShareFormRow[];
  submitLabel: string;
  /** Runs the create or update action; field errors of the answer land on their fields. */
  onSubmit: (input: CreateShareLinkInput) => Promise<ActionResult<unknown>>;
}

/**
 * Fields of a portal link (PRD §8.11): title, message, portal language, expiry, downloads and the documents, each
 * pinned to a version or following the latest, with an optional access key (DT-45). Used by the create dialog and
 * the edit sheet of the link detail.
 */
export function ShareForm({
  idPrefix,
  defaults,
  clientId,
  initialRows,
  submitLabel,
  onSubmit,
}: ShareFormProps) {
  const t = useTranslations("shares.form");
  const tAll = useTranslations();
  const [rows, setRows] = useState(initialRows);
  const [documentsError, setDocumentsError] = useState(false);
  const [pending, startTransition] = useTransition();

  const form = useForm<LinkFieldsValues, unknown, LinkFields>({
    defaultValues: defaults,
    resolver: zodResolver(linkFieldsSchema),
  });
  const errors = form.formState.errors;

  function updateRow(id: string, patch: Partial<ShareFormRow>) {
    setRows((current) => current.map((row) => (row.doc.id === id ? { ...row, ...patch } : row)));
    if (patch.included) setDocumentsError(false);
  }

  async function loadOptions(query: string): Promise<AsyncComboboxOption[]> {
    const result = await searchDocumentsAction({ q: query });
    if (!result.ok) return [];
    return result.data.map((doc) => ({ value: doc.id, label: doc.label, description: doc.code }));
  }

  async function addDocument(option: AsyncComboboxOption | null) {
    if (!option) return;
    if (rows.some((row) => row.doc.id === option.value)) {
      updateRow(option.value, { included: true });
      return;
    }
    const result = await getShareableDocumentAction({ id: option.value });
    if (!result.ok) {
      toast.error(t("addFailed"));
      return;
    }
    setRows((current) => [...current, newShareFormRow(result.data)]);
    setDocumentsError(false);
  }

  const included = rows.filter((row) => row.included);

  const submit = form.handleSubmit(
    (values) => {
      if (included.length === 0) {
        setDocumentsError(true);
        return;
      }
      const documents: ShareDocumentInput[] = included.map((row) => ({
        documentId: row.doc.id,
        versionId: row.versionId,
        requiresAccessKey: row.requiresAccessKey,
      }));
      const input: CreateShareLinkInput = { ...values, documents };
      if (clientId) input.clientId = clientId;
      startTransition(async () => {
        const result = await onSubmit(input);
        if (result.ok) return;
        let onFields = false;
        for (const [name, messages] of Object.entries(result.error.fieldErrors ?? {})) {
          if ((FORM_FIELDS as readonly string[]).includes(name) && messages[0]) {
            form.setError(name as FormField, { message: messages[0] });
            onFields = true;
          } else if (name.startsWith("documents")) {
            setDocumentsError(true);
            onFields = true;
          }
        }
        if (!onFields) {
          const key = `common.errors.${result.error.code}`;
          toast.error(tAll.has(key) ? tAll(key) : t("saveFailed"));
        }
      });
    },
    // The documents are checked on every submit, so their error shows next to the field errors.
    () => setDocumentsError(included.length === 0),
  );

  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <form noValidate className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
      <Field data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor={id("title")}>{t("fields.title")}</FieldLabel>
        <Input
          id={id("title")}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? id("title-error") : undefined}
          {...form.register("title")}
        />
        <FormFieldError id={id("title-error")} message={errors.title?.message} />
      </Field>

      <Field data-invalid={errors.message ? true : undefined}>
        <FieldLabel htmlFor={id("message")}>{t("fields.message")}</FieldLabel>
        <Textarea
          id={id("message")}
          rows={3}
          aria-invalid={errors.message ? true : undefined}
          {...form.register("message")}
        />
        <FieldDescription>{t("hints.message")}</FieldDescription>
        <FormFieldError id={id("message-error")} message={errors.message?.message} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={id("locale")}>{t("fields.locale")}</FieldLabel>
          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <Select value={field.value ?? "es"} onValueChange={field.onChange}>
                <SelectTrigger id={id("locale")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALE_VALUES.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {tAll(`shares.detail.locales.${locale}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field data-invalid={errors.expiresAt ? true : undefined}>
          <FieldLabel htmlFor={id("expires")}>{t("fields.expiresAt")}</FieldLabel>
          <Controller
            control={form.control}
            name="expiresAt"
            render={({ field }) => (
              <DateField
                id={id("expires")}
                value={field.value ?? ""}
                onChange={(value) => field.onChange(value || undefined)}
                placeholder={t("placeholders.expiresAt")}
                aria-invalid={errors.expiresAt ? true : undefined}
              />
            )}
          />
          <FieldDescription>{t("hints.expiresAt")}</FieldDescription>
          <FormFieldError id={id("expires-error")} message={errors.expiresAt?.message} />
        </Field>
      </div>

      <Field orientation="horizontal">
        <Controller
          control={form.control}
          name="allowDownload"
          render={({ field }) => (
            <Switch
              id={id("download")}
              checked={field.value ?? true}
              onCheckedChange={field.onChange}
            />
          )}
        />
        <FieldLabel htmlFor={id("download")}>{t("fields.allowDownload")}</FieldLabel>
      </Field>

      <FieldSet data-invalid={documentsError || undefined}>
        <FieldLegend>{t("fields.documents")}</FieldLegend>
        <FieldDescription>{t("hints.documents")}</FieldDescription>
        <ul className="flex flex-col divide-y rounded-lg border">
          {rows.map((row) => (
            <DocumentRow
              key={row.doc.id}
              idPrefix={idPrefix}
              row={row}
              disabled={pending}
              onChange={(patch) => updateRow(row.doc.id, patch)}
            />
          ))}
        </ul>
        {/* The modal sets `pointer-events: none` on <body>; the combobox popup is portaled there too. */}
        <style>{`[data-slot="combobox-content"] { pointer-events: auto; }`}</style>
        <AsyncCombobox
          id={id("add-document")}
          aria-label={t("placeholders.addDocument")}
          value={null}
          onChange={(option) => void addDocument(option)}
          loadOptions={loadOptions}
          placeholder={t("placeholders.addDocument")}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">{t("keyHint")}</p>
        {documentsError ? (
          <FieldError id={id("documents-error")} errors={[{ message: t("noDocuments") }]} />
        ) : null}
      </FieldSet>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface DocumentRowProps {
  idPrefix: string;
  row: ShareFormRow;
  disabled: boolean;
  onChange: (patch: Partial<ShareFormRow>) => void;
}

function DocumentRow({ idPrefix, row, disabled, onChange }: DocumentRowProps) {
  const t = useTranslations("shares.form");
  const { doc } = row;
  const includeId = `${idPrefix}-include-${doc.id}`;

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Checkbox
          id={includeId}
          aria-label={t("include", { title: doc.title })}
          checked={row.included}
          onCheckedChange={(value) => onChange({ included: value === true })}
          disabled={disabled}
        />
        <label htmlFor={includeId} className="min-w-0 truncate text-sm font-medium">
          <span className="mr-2 font-mono text-xs text-muted-foreground">{doc.code}</span>
          {doc.title}
        </label>
      </div>
      {row.included ? (
        <div className="flex items-center gap-3">
          <Select
            value={row.versionId ?? LATEST}
            onValueChange={(value) => onChange({ versionId: value === LATEST ? null : value })}
            disabled={disabled}
          >
            <SelectTrigger
              size="sm"
              className="w-48"
              aria-label={t("version", { title: doc.title })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={LATEST}>{t("latestOption")}</SelectItem>
              {doc.versions.map((version) => (
                <SelectItem key={version.id} value={version.id}>
                  {version.id === doc.currentVersionId
                    ? t("currentVersionOption", { number: version.versionNumber })
                    : t("versionOption", { number: version.versionNumber })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Switch
            aria-label={t("toggleKey", { title: doc.title })}
            checked={row.requiresAccessKey}
            onCheckedChange={(value) => onChange({ requiresAccessKey: value })}
            disabled={disabled}
          />
        </div>
      ) : null}
    </li>
  );
}

/** A field's message, translated when it is a key (zod messages are keys). Renders nothing without a message. */
function FormFieldError({ id, message }: { id: string; message: string | undefined }) {
  const t = useTranslations();
  if (!message) return null;
  return <FieldError id={id} errors={[{ message: t.has(message) ? t(message) : message }]} />;
}
