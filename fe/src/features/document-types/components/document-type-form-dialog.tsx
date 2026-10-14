"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
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
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import { applyFieldErrors } from "@/features/catalogs/components/form-errors";
import {
  createDocumentTypeInputSchema,
  type CreateDocumentTypeFormValues,
  type DocumentCategoryDetailDTO,
  type DocumentTypeDetailDTO,
} from "@/lib/validators/document-types";
import { DOCUMENT_FORMAT_VALUES } from "@/lib/validators/enums";
import { z } from "@/lib/validators/zod";
import { createDocumentTypeAction, updateDocumentTypeAction } from "../actions";

/** A type as the settings list holds it: inside its category, so without the `category` ref. */
export type DocumentTypeItem = Omit<DocumentTypeDetailDTO, "category">;

export type DocumentTypeFormTarget =
  | { mode: "create"; categoryId: string }
  | { mode: "edit"; type: DocumentTypeItem; categoryId: string }
  | null;

type FormOutput = z.output<typeof createDocumentTypeInputSchema>;

type DocumentTypeFormDialogProps = {
  target: DocumentTypeFormTarget;
  categories: DocumentCategoryDetailDTO[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const FIELDS = ["categoryId", "name", "nameEn", "defaultFormat"] as const;
const CAPABILITIES = ["requiresSignature", "hasExpiration", "active"] as const;
const HINTS = {
  requiresSignature: "requiresSignatureHint",
  hasExpiration: "hasExpirationHint",
  active: "activeHint",
} as const;

function DocumentTypeForm({
  target,
  categories,
  onOpenChange,
  onSaved,
}: DocumentTypeFormDialogProps) {
  const t = useTranslations("catalogs.documentTypes");
  const tEnums = useTranslations("enums");
  const tRoot = useTranslations();
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const type = target?.mode === "edit" ? target.type : null;

  const form = useForm<CreateDocumentTypeFormValues, unknown, FormOutput>({
    resolver: zodResolver(createDocumentTypeInputSchema),
    defaultValues: {
      categoryId: target?.categoryId ?? "",
      name: type?.name ?? "",
      nameEn: type?.nameEn ?? "",
      requiresSignature: type?.requiresSignature ?? false,
      hasExpiration: type?.hasExpiration ?? false,
      defaultFormat: type?.defaultFormat ?? "ARCHIVO",
      active: type?.active ?? true,
    },
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormOutput) {
    const result = type
      ? await updateDocumentTypeAction({ ...values, id: type.id })
      : await createDocumentTypeAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(type ? t("toast.typeUpdated") : t("toast.typeCreated"));
    onSaved();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{type ? t("typeForm.editTitle") : t("typeForm.createTitle")}</DialogTitle>
        <DialogDescription>{t("typeForm.description")}</DialogDescription>
      </DialogHeader>

      <Controller
        control={form.control}
        name="categoryId"
        render={({ field }) => (
          <Field data-invalid={errors.categoryId ? true : undefined}>
            <FieldLabel htmlFor="document-type-category">
              {t("typeForm.fields.category")}
            </FieldLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger
                id="document-type-category"
                className="w-full"
                aria-invalid={errors.categoryId ? true : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {catalogLabel(category, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{message(errors.categoryId?.message)}</FieldError>
          </Field>
        )}
      />

      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="document-type-name">{t("typeForm.fields.name")}</FieldLabel>
        <Input
          id="document-type-name"
          aria-invalid={errors.name ? true : undefined}
          {...form.register("name")}
        />
        <FieldError>{message(errors.name?.message)}</FieldError>
      </Field>

      <Field data-invalid={errors.nameEn ? true : undefined}>
        <FieldLabel htmlFor="document-type-name-en">{t("typeForm.fields.nameEn")}</FieldLabel>
        <Input
          id="document-type-name-en"
          aria-describedby="document-type-name-en-hint"
          aria-invalid={errors.nameEn ? true : undefined}
          {...form.register("nameEn")}
        />
        <FieldDescription id="document-type-name-en-hint">
          {t("typeForm.fields.nameEnHint")}
        </FieldDescription>
        <FieldError>{message(errors.nameEn?.message)}</FieldError>
      </Field>

      <Controller
        control={form.control}
        name="defaultFormat"
        render={({ field }) => (
          <Field data-invalid={errors.defaultFormat ? true : undefined}>
            <FieldLabel htmlFor="document-type-format">
              {t("typeForm.fields.defaultFormat")}
            </FieldLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="document-type-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_FORMAT_VALUES.map((format) => (
                  <SelectItem key={format} value={format}>
                    {tEnums(`DocumentFormat.${format}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{message(errors.defaultFormat?.message)}</FieldError>
          </Field>
        )}
      />

      {CAPABILITIES.map((name) => (
        <Controller
          key={name}
          control={form.control}
          name={name}
          render={({ field }) => (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={`document-type-${name}`}>
                  {t(`typeForm.fields.${name}`)}
                </FieldLabel>
                <FieldDescription id={`document-type-${name}-hint`}>
                  {t(`typeForm.fields.${HINTS[name]}`)}
                </FieldDescription>
              </FieldContent>
              <Switch
                id={`document-type-${name}`}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
                aria-describedby={`document-type-${name}-hint`}
              />
            </Field>
          )}
        />
      ))}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={form.formState.isSubmitting}
        >
          {tActions("cancel")}
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {type ? tActions("save") : t("typeForm.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create and edit dialog of a document type: its category, names, default format and capabilities (PRD §8.9.1).
export function DocumentTypeFormDialog(props: DocumentTypeFormDialogProps) {
  const { target, onOpenChange } = props;
  const key =
    target?.mode === "edit"
      ? `edit-${target.type.id}`
      : target
        ? `create-${target.categoryId}`
        : "closed";
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain">
        {target ? <DocumentTypeForm key={key} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}
