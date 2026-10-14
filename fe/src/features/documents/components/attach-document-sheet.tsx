"use client";

import { useRef, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PlusIcon } from "lucide-react";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Uploader } from "@/components/ui/uploader";
import { uploadAdapter } from "@/features/files/upload-adapter";
import type { DocumentCategoryDetailDTO } from "@/lib/validators/document-types";
import type { EntityRef } from "@/lib/validators/common";
import {
  createDocumentInputSchemaFor,
  type CreateDocumentFormValues,
  type DocumentLinkTarget,
} from "@/lib/validators/documents";
import type { FileDTO } from "@/lib/validators/files";
import {
  createDocumentAction,
  linkDocumentAction,
  searchDocumentsAction,
  uploadDocumentVersionAction,
} from "../actions";

type Mode = "upload" | "link";

/**
 * The link this record's documents get. Only CLIENT and PROJECT records take documents in H1-B2; `null` for any
 * other entity. (A client module cannot export a helper the server tab calls, so the tab keeps its own copy.)
 */
function linkTargetOf(entity: EntityRef): DocumentLinkTarget | null {
  if (entity.type !== "CLIENT" && entity.type !== "PROJECT") return null;
  return { entityType: entity.type, entityId: entity.id };
}

/** Form fields the server may answer `fieldErrors` for (the keys of `CreateDocumentFormValues`). */
const FORM_FIELDS = [
  "title",
  "typeId",
  "summary",
  "effectiveDate",
  "signedAt",
  "expiresAt",
] as const;
type FormField = (typeof FORM_FIELDS)[number];

function isFormField(name: string): name is FormField {
  return (FORM_FIELDS as readonly string[]).includes(name);
}

interface AttachDocumentSheetProps {
  /** The client or project the document is attached to. */
  entity: EntityRef;
  /** Categories with their types, from `listDocumentCategories`; the type picker groups them. */
  categories: readonly DocumentCategoryDetailDTO[];
}

/**
 * "Adjuntar documento" sheet (wireframe 4.6), two modes: upload a new file as a new document linked to this
 * record, or link an existing document. Uploads go through the shared `Uploader` and file adapter (25 MB general
 * context). The type's rules (signature date, expiry date) apply through `createDocumentInputSchemaFor`, on
 * the client and again in the service. Documents open at `/documents/[id]`, an in-shell 404 until H1-B4.
 */
export function AttachDocumentSheet({ entity, categories }: AttachDocumentSheetProps) {
  const t = useTranslations("documents");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("upload");

  const target = linkTargetOf(entity);
  if (!target) return null;
  const types = categories.flatMap((category) => category.types.filter((type) => type.active));

  function close() {
    setOpen(false);
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <PlusIcon aria-hidden="true" />
          {t("tab.attach")}
        </Button>
      </SheetTrigger>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-lg"
        onInteractOutside={keepOpenOnComboboxPopup}
      >
        <SheetHeader>
          <SheetTitle>{t("sheet.title")}</SheetTitle>
          <SheetDescription>{t("sheet.description")}</SheetDescription>
        </SheetHeader>
        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)} className="px-4 pb-6">
          <TabsList>
            <TabsTrigger value="upload">{t("sheet.modes.upload")}</TabsTrigger>
            <TabsTrigger value="link">{t("sheet.modes.link")}</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <UploadDocumentForm
              target={target}
              types={types}
              categories={categories}
              locale={locale}
              onDone={close}
            />
          </TabsContent>
          <TabsContent value="link">
            <LinkDocumentForm target={target} onDone={close} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The combobox popup lives in its own portal, outside the sheet. Radix reads a press on it as an outside
 * interaction and would close the sheet before the option takes the click.
 */
function keepOpenOnComboboxPopup(event: {
  detail: { originalEvent: Event };
  preventDefault: () => void;
}) {
  const target = event.detail.originalEvent.target;
  if (target instanceof Element && target.closest('[data-slot="combobox-content"]'))
    event.preventDefault();
}

// ───────────────────────────── Upload mode ─────────────────────────────

type UploadForm = UseFormReturn<CreateDocumentFormValues>;
/** A type as its category lists it (no back-reference to the category). */
type CategoryType = DocumentCategoryDetailDTO["types"][number];

interface UploadDocumentFormProps {
  target: DocumentLinkTarget;
  types: readonly CategoryType[];
  categories: readonly DocumentCategoryDetailDTO[];
  locale: string;
  onDone: () => void;
}

function UploadDocumentForm({
  target,
  types,
  categories,
  locale,
  onDone,
}: UploadDocumentFormProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [typeId, setTypeId] = useState("");
  const [file, setFile] = useState<FileDTO | null>(null);
  const [fileMissing, setFileMissing] = useState(false);

  const selectedType = types.find((type) => type.id === typeId);
  // The resolver reads the rules of the type picked last; `pickType` keeps them current (an event, not a render).
  const rules = useRef(NO_TYPE_RULES);

  const form: UploadForm = useForm<CreateDocumentFormValues>({
    defaultValues: { title: "", typeId: "", summary: "" },
    resolver: (values, context, options) =>
      zodResolver(createDocumentInputSchemaFor(rules.current))(values, context, options),
  });

  function pickType(value: string) {
    const picked = types.find((type) => type.id === value);
    rules.current = picked ? typeRules(picked) : NO_TYPE_RULES;
    setTypeId(value);
    form.setValue("typeId", value, { shouldValidate: form.formState.isSubmitted });
  }

  const submitValid = form.handleSubmit((values) => {
    if (!file) return;
    startTransition(async () => {
      const created = await createDocumentAction({ ...values, links: [target] });
      if (!created.ok) {
        // The server's field errors land on their fields; anything else is a failure of the whole request.
        let onFields = false;
        for (const [name, messages] of Object.entries(created.error.fieldErrors ?? {})) {
          if (isFormField(name) && messages[0]) {
            form.setError(name, { message: messages[0] });
            onFields = true;
          }
        }
        if (!onFields) {
          const message = created.error.message;
          toast.error(t.has(message) ? t(message) : t("documents.sheet.createFailed"));
        }
        return;
      }
      const version = await uploadDocumentVersionAction({
        format: "ARCHIVO",
        documentId: created.data.id,
        fileId: file.id,
      });
      if (version.ok) toast.success(t("documents.sheet.uploaded"));
      else toast.error(t("documents.sheet.versionFailed"));
      onDone();
    });
  });

  const errors = form.formState.errors;

  return (
    <form
      noValidate
      className="flex flex-col gap-4 pt-4"
      onSubmit={(event) => {
        // The file is checked on every submit, so a missing file shows next to the field errors.
        if (!file) setFileMissing(true);
        void submitValid(event);
      }}
    >
      <Field data-invalid={fileMissing || undefined}>
        <FieldLabel htmlFor="attach-file">{t("documents.sheet.fields.file")}</FieldLabel>
        <Uploader
          id="attach-file"
          adapter={uploadAdapter}
          context="general"
          multiple={false}
          onChange={(files) => {
            setFile(files[0] ?? null);
            setFileMissing(false);
          }}
          disabled={pending}
          aria-label={t("documents.sheet.fields.file")}
        />
        {fileMissing ? (
          <FieldError
            id="attach-file-error"
            errors={[{ message: t("documents.sheet.fileRequired") }]}
          />
        ) : null}
      </Field>

      <Field data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor="attach-title">{t("documents.sheet.fields.title")}</FieldLabel>
        <Input
          id="attach-title"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "attach-title-error" : undefined}
          placeholder={t("documents.sheet.placeholders.title")}
          {...form.register("title")}
        />
        <FormFieldError id="attach-title-error" message={errors.title?.message} />
      </Field>

      <Field data-invalid={errors.typeId ? true : undefined}>
        <FieldLabel htmlFor="attach-type">{t("documents.sheet.fields.type")}</FieldLabel>
        <Select value={typeId || undefined} onValueChange={pickType}>
          <SelectTrigger
            id="attach-type"
            aria-invalid={errors.typeId ? true : undefined}
            aria-describedby={errors.typeId ? "attach-type-error" : undefined}
          >
            <SelectValue placeholder={t("documents.sheet.placeholders.type")} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => {
              const active = category.types.filter((type) => type.active);
              if (active.length === 0) return null;
              return (
                <SelectGroup key={category.id}>
                  <SelectLabel>{localName(category, locale)}</SelectLabel>
                  {active.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {localName(type, locale)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
        <FormFieldError id="attach-type-error" message={errors.typeId?.message} />
      </Field>

      <Field data-invalid={errors.summary ? true : undefined}>
        <FieldLabel htmlFor="attach-summary">{t("documents.sheet.fields.summary")}</FieldLabel>
        <Textarea
          id="attach-summary"
          aria-invalid={errors.summary ? true : undefined}
          aria-describedby={errors.summary ? "attach-summary-error" : undefined}
          {...form.register("summary")}
        />
        <FormFieldError id="attach-summary-error" message={errors.summary?.message} />
      </Field>

      <DateFieldRow
        form={form}
        name="effectiveDate"
        id="attach-effective"
        label={t("documents.sheet.fields.effectiveDate")}
        placeholder={t("documents.sheet.placeholders.date")}
      />
      {selectedType?.requiresSignature ? (
        <DateFieldRow
          form={form}
          name="signedAt"
          id="attach-signed"
          label={t("documents.sheet.fields.signedAt")}
          placeholder={t("documents.sheet.placeholders.date")}
        />
      ) : null}
      {selectedType?.hasExpiration ? (
        <DateFieldRow
          form={form}
          name="expiresAt"
          id="attach-expires"
          label={t("documents.sheet.fields.expiresAt")}
          placeholder={t("documents.sheet.placeholders.date")}
        />
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending} aria-disabled={pending || undefined}>
          {t("documents.sheet.submit.upload")}
        </Button>
      </div>
    </form>
  );
}

interface DateFieldRowProps {
  form: UploadForm;
  name: "effectiveDate" | "signedAt" | "expiresAt";
  id: string;
  label: string;
  placeholder: string;
}

/** A date of the form: empty means "not set", so the value stays `undefined` and the schema reads it as absent. */
function DateFieldRow({ form, name, id, label, placeholder }: DateFieldRowProps) {
  const message = form.formState.errors[name]?.message;
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
            placeholder={placeholder}
            aria-invalid={message ? true : undefined}
          />
        )}
      />
      <FormFieldError id={`${id}-error`} message={message} />
    </Field>
  );
}

// ───────────────────────────── Link mode ─────────────────────────────

interface LinkDocumentFormProps {
  target: DocumentLinkTarget;
  onDone: () => void;
}

function LinkDocumentForm({ target, onDone }: LinkDocumentFormProps) {
  const t = useTranslations("documents.sheet");
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<AsyncComboboxOption | null>(null);

  // The server answers the query over every document (at most 20, archived left out); a link that already exists
  // changes nothing.
  async function loadOptions(query: string): Promise<AsyncComboboxOption[]> {
    const result = await searchDocumentsAction({ q: query });
    if (!result.ok) return [];
    return result.data.map((document) => ({
      value: document.id,
      label: document.label,
      description: document.code,
    }));
  }

  function submit() {
    if (!selected) return;
    startTransition(async () => {
      const result = await linkDocumentAction({ documentId: selected.value, target });
      if (!result.ok) {
        toast.error(t("linkFailed"));
        return;
      }
      toast.success(t("linked"));
      onDone();
    });
  }

  return (
    <form
      className="flex flex-col gap-4 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* The modal sheet sets `pointer-events: none` on <body>; the combobox popup is portaled there too, so a
          click would fall through to the sheet behind it. */}
      <style>{`[data-slot="combobox-content"] { pointer-events: auto; }`}</style>
      <Field>
        <FieldLabel htmlFor="attach-existing">{t("fields.document")}</FieldLabel>
        <AsyncCombobox
          id="attach-existing"
          value={selected}
          onChange={setSelected}
          loadOptions={loadOptions}
          placeholder={t("placeholders.document")}
          disabled={pending}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending || !selected}>
          {t("submit.link")}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────────── Helpers ─────────────────────────────

const NO_TYPE_RULES = { requiresSignature: false, hasExpiration: false };

function typeRules(type: CategoryType) {
  return { requiresSignature: type.requiresSignature, hasExpiration: type.hasExpiration };
}

/** Catalog label in the current locale: the English name in English when the catalog has one (PRD §7.8). */
function localName(item: { name: string; nameEn: string | null }, locale: string): string {
  return locale === "en" && item.nameEn ? item.nameEn : item.name;
}

/** A field's message, translated when it is a key (zod messages are keys). Renders nothing without a message. */
function FormFieldError({ id, message }: { id: string; message: string | undefined }) {
  const t = useTranslations();
  if (!message) return null;
  return <FieldError id={id} errors={[{ message: t.has(message) ? t(message) : message }]} />;
}
