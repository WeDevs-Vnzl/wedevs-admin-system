"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { applyFieldErrors } from "@/features/catalogs/components/form-errors";
import {
  createDocumentCategoryInputSchema,
  type DocumentCategoryDetailDTO,
} from "@/lib/validators/document-types";
import { z } from "@/lib/validators/zod";
import { createDocumentCategoryAction, updateDocumentCategoryAction } from "../actions";

export type DocumentCategoryFormTarget =
  { mode: "create" } | { mode: "edit"; category: DocumentCategoryDetailDTO } | null;

type FormValues = z.input<typeof createDocumentCategoryInputSchema>;
type FormOutput = z.output<typeof createDocumentCategoryInputSchema>;

type DocumentCategoryFormDialogProps = {
  target: DocumentCategoryFormTarget;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const FIELDS = ["name", "nameEn", "color"] as const;

function DocumentCategoryForm({ target, onOpenChange, onSaved }: DocumentCategoryFormDialogProps) {
  const t = useTranslations("catalogs.documentTypes");
  const tRoot = useTranslations();
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("common.errors");
  const category = target?.mode === "edit" ? target.category : null;

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(createDocumentCategoryInputSchema),
    defaultValues: {
      name: category?.name ?? "",
      nameEn: category?.nameEn ?? "",
      color: category?.color ?? undefined,
    },
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormOutput) {
    const result = category
      ? await updateDocumentCategoryAction({ ...values, id: category.id })
      : await createDocumentCategoryAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(category ? t("toast.categoryUpdated") : t("toast.categoryCreated"));
    onSaved();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {category ? t("categoryForm.editTitle") : t("categoryForm.createTitle")}
        </DialogTitle>
        <DialogDescription>{t("categoryForm.description")}</DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="document-category-name">{t("categoryForm.fields.name")}</FieldLabel>
        <Input
          id="document-category-name"
          aria-invalid={errors.name ? true : undefined}
          {...form.register("name")}
        />
        <FieldError>{message(errors.name?.message)}</FieldError>
      </Field>

      <Field data-invalid={errors.nameEn ? true : undefined}>
        <FieldLabel htmlFor="document-category-name-en">
          {t("categoryForm.fields.nameEn")}
        </FieldLabel>
        <Input
          id="document-category-name-en"
          aria-describedby="document-category-name-en-hint"
          aria-invalid={errors.nameEn ? true : undefined}
          {...form.register("nameEn")}
        />
        <FieldDescription id="document-category-name-en-hint">
          {t("categoryForm.fields.nameEnHint")}
        </FieldDescription>
        <FieldError>{message(errors.nameEn?.message)}</FieldError>
      </Field>

      <Controller
        control={form.control}
        name="color"
        render={({ field }) => (
          <Field data-invalid={errors.color ? true : undefined}>
            <FieldLabel htmlFor="document-category-color">
              {t("categoryForm.fields.color")}
            </FieldLabel>
            <Input
              id="document-category-color"
              className="font-mono"
              placeholder="#RRGGBB"
              aria-describedby="document-category-color-hint"
              aria-invalid={errors.color ? true : undefined}
              value={field.value ?? ""}
              onChange={(event) => field.onChange(event.target.value.trim() || undefined)}
              onBlur={field.onBlur}
            />
            <FieldDescription id="document-category-color-hint">
              {t("categoryForm.fields.colorHint")}
            </FieldDescription>
            <FieldError>{message(errors.color?.message)}</FieldError>
          </Field>
        )}
      />

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
          {category ? tActions("save") : t("categoryForm.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create and edit dialog of a document category. The order is not a field: the list moves categories up and down.
export function DocumentCategoryFormDialog(props: DocumentCategoryFormDialogProps) {
  const { target, onOpenChange } = props;
  const key = target?.mode === "edit" ? `edit-${target.category.id}` : (target?.mode ?? "closed");
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>{target ? <DocumentCategoryForm key={key} {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
