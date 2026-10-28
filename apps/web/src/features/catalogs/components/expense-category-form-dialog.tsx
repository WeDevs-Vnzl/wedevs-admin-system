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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  createExpenseCategoryInputSchema,
  type ExpenseCategoryDTO,
  type ExpenseCategoryTreeNode,
} from "@/lib/validators/catalogs";
import { z } from "@/lib/validators/zod";
import { createExpenseCategoryAction, updateExpenseCategoryAction } from "../actions";
import { catalogLabel } from "./catalog-label";
import { applyFieldErrors } from "./form-errors";

export type ExpenseCategoryFormTarget =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; category: ExpenseCategoryDTO; hasChildren: boolean }
  | null;

type FormValues = z.input<typeof createExpenseCategoryInputSchema>;
type FormOutput = z.output<typeof createExpenseCategoryInputSchema>;

type ExpenseCategoryFormDialogProps = {
  target: ExpenseCategoryFormTarget;
  /** Root categories: the only valid parents (two-level tree). */
  roots: ExpenseCategoryTreeNode[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const FIELDS = ["name", "nameEn", "color", "parentId", "active"] as const;
const NO_PARENT = "__none__";

function ExpenseCategoryForm({
  target,
  roots,
  onOpenChange,
  onSaved,
}: ExpenseCategoryFormDialogProps) {
  const t = useTranslations("catalogs.expenseCategories");
  const tRoot = useTranslations();
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const category = target?.mode === "edit" ? target.category : null;
  // A category with subcategories stays a root (service rule: depth ≤ 2).
  const parentLocked = target?.mode === "edit" && target.hasChildren;
  const parents = roots.filter((root) => root.id !== category?.id);

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(createExpenseCategoryInputSchema),
    defaultValues: category
      ? {
          name: category.name,
          nameEn: category.nameEn ?? "",
          color: category.color,
          parentId: category.parentId,
          active: category.active,
        }
      : {
          name: "",
          nameEn: "",
          color: null,
          parentId: target?.mode === "create" ? target.parentId : null,
          active: true,
        },
  });
  const errors = form.formState.errors;
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormOutput) {
    const result = category
      ? await updateExpenseCategoryAction({ ...values, id: category.id })
      : await createExpenseCategoryAction(values);
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error.fieldErrors, FIELDS);
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(category ? t("toast.updated") : t("toast.created"));
    onSaved();
  }

  const title = category
    ? t("form.editTitle")
    : target?.mode === "create" && target.parentId
      ? t("form.createChildTitle")
      : t("form.createTitle");

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t("form.description")}</DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="expense-category-name">{t("form.fields.name")}</FieldLabel>
        <Input
          id="expense-category-name"
          aria-invalid={errors.name ? true : undefined}
          {...form.register("name")}
        />
        <FieldError>{message(errors.name?.message)}</FieldError>
      </Field>

      <Field data-invalid={errors.nameEn ? true : undefined}>
        <FieldLabel htmlFor="expense-category-name-en">{t("form.fields.nameEn")}</FieldLabel>
        <Input
          id="expense-category-name-en"
          aria-describedby="expense-category-name-en-hint"
          aria-invalid={errors.nameEn ? true : undefined}
          {...form.register("nameEn")}
        />
        <FieldDescription id="expense-category-name-en-hint">
          {t("form.fields.nameEnHint")}
        </FieldDescription>
        <FieldError>{message(errors.nameEn?.message)}</FieldError>
      </Field>

      <Controller
        control={form.control}
        name="color"
        render={({ field }) => (
          <Field data-invalid={errors.color ? true : undefined}>
            <FieldLabel htmlFor="expense-category-color">{t("form.fields.color")}</FieldLabel>
            <Input
              id="expense-category-color"
              className="font-mono"
              placeholder="#RRGGBB"
              aria-describedby="expense-category-color-hint"
              aria-invalid={errors.color ? true : undefined}
              value={field.value ?? ""}
              onChange={(event) => field.onChange(event.target.value.trim() || null)}
              onBlur={field.onBlur}
            />
            <FieldDescription id="expense-category-color-hint">
              {t("form.fields.colorHint")}
            </FieldDescription>
            <FieldError>{message(errors.color?.message)}</FieldError>
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="parentId"
        render={({ field }) => (
          <Field data-invalid={errors.parentId ? true : undefined}>
            <FieldLabel htmlFor="expense-category-parent">{t("form.fields.parent")}</FieldLabel>
            <Select
              value={field.value ?? NO_PARENT}
              onValueChange={(value) => field.onChange(value === NO_PARENT ? null : value)}
              disabled={parentLocked}
            >
              <SelectTrigger
                id="expense-category-parent"
                className="w-full"
                aria-invalid={errors.parentId ? true : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>{t("form.fields.parentNone")}</SelectItem>
                {parents.map((root) => (
                  <SelectItem key={root.id} value={root.id}>
                    {catalogLabel(root, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {parentLocked ? <FieldDescription>{t("errors.hasChildren")}</FieldDescription> : null}
            <FieldError>{message(errors.parentId?.message)}</FieldError>
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="active"
        render={({ field }) => (
          <Field orientation="horizontal">
            <FieldLabel htmlFor="expense-category-active">{t("form.fields.active")}</FieldLabel>
            <Switch
              id="expense-category-active"
              checked={field.value ?? true}
              onCheckedChange={field.onChange}
            />
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
          {category ? tActions("save") : t("form.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create and edit dialog of an expense category. The parent can only be a root category (two-level tree).
export function ExpenseCategoryFormDialog(props: ExpenseCategoryFormDialogProps) {
  const { target, onOpenChange } = props;
  const key =
    target?.mode === "edit"
      ? `edit-${target.category.id}`
      : target
        ? `create-${target.parentId ?? "root"}`
        : "closed";
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>{target ? <ExpenseCategoryForm key={key} {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
