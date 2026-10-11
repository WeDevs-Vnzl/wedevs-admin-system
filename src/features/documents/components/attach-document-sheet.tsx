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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { DocumentsTabEntity } from "../queries";

type Mode = "upload" | "link";

const SEARCH_PAGE_SIZE = 25;

interface AttachDocumentSheetProps {
  /** The client or project the document is attached to. */
  entity: DocumentsTabEntity;
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

  const target: DocumentLinkTarget = { entityType: entity.type, entityId: entity.id };
  const types = categories.flatMap((category) => category.types.filter((type) => type.active));

  function close() {
    setOpen(false);
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <PlusIcon aria-hidden="true" />
          {t("tab.attach")}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
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
        const message = created.error.message;
        toast.error(t.has(message) ? t(message) : t("documents.sheet.createFailed"));
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
      <div className="grid gap-2">
        <Label htmlFor="attach-file">{t("documents.sheet.fields.file")}</Label>
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
          <p role="alert" className="text-sm text-destructive">
            {t("documents.sheet.fileRequired")}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="attach-title">{t("documents.sheet.fields.title")}</Label>
        <Input
          id="attach-title"
          aria-invalid={form.formState.errors.title ? true : undefined}
          placeholder={t("documents.sheet.placeholders.title")}
          {...form.register("title")}
        />
        <FieldError message={form.formState.errors.title?.message} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="attach-type">{t("documents.sheet.fields.type")}</Label>
        <Select value={typeId || undefined} onValueChange={pickType}>
          <SelectTrigger
            id="attach-type"
            aria-invalid={form.formState.errors.typeId ? true : undefined}
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
        <FieldError message={form.formState.errors.typeId?.message} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="attach-summary">{t("documents.sheet.fields.summary")}</Label>
        <Textarea id="attach-summary" {...form.register("summary")} />
        <FieldError message={form.formState.errors.summary?.message} />
      </div>

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
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <DateField
            id={id}
            value={field.value ?? ""}
            onChange={(value) => field.onChange(value || undefined)}
            placeholder={placeholder}
          />
        )}
      />
      <FieldError message={form.formState.errors[name]?.message} />
    </div>
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

  // The server answers the query over every document; a link that already exists changes nothing.
  async function loadOptions(query: string): Promise<AsyncComboboxOption[]> {
    const result = await searchDocumentsAction({ q: query, pageSize: SEARCH_PAGE_SIZE });
    if (!result.ok) return [];
    return result.data.items.map((document) => ({
      value: document.id,
      label: document.title,
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
      <div className="grid gap-2">
        <Label htmlFor="attach-existing">{t("fields.document")}</Label>
        <AsyncCombobox
          id="attach-existing"
          value={selected}
          onChange={setSelected}
          loadOptions={loadOptions}
          placeholder={t("placeholders.document")}
          disabled={pending}
        />
      </div>
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

function FieldError({ message }: { message: string | undefined }) {
  const t = useTranslations();
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(message) ? t(message) : message}
    </p>
  );
}
