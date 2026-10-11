"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createTagAction, updateTagAction } from "@/features/tags/actions";
import {
  createTagInputSchema,
  type CreateTagInput,
  type TagListRowDTO,
} from "@/lib/validators/tags";
import { ColorSwatches, PRESET_TAG_COLORS } from "./color-swatches";

type TagFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tag being edited; without it the dialog creates one. */
  tag?: TagListRowDTO;
  /** Called after a successful save so the table reloads its rows. */
  onSaved?: () => void;
};

/** Create or edit a tag: name and colour (preset swatches or a hex value). No delete (not in PRD §12). */
export function TagFormDialog({ open, onOpenChange, tag, onSaved }: TagFormDialogProps) {
  const t = useTranslations("tags");
  const tRoot = useTranslations();
  const form = useForm<CreateTagInput>({
    resolver: zodResolver(createTagInputSchema),
    defaultValues: { name: tag?.name ?? "", color: tag?.color ?? PRESET_TAG_COLORS[4] },
  });

  async function onSubmit(values: CreateTagInput) {
    const result = tag
      ? await updateTagAction({ id: tag.id, ...values })
      : await createTagAction(values);

    if (!result.ok) {
      const nameError = result.error.fieldErrors?.name?.[0];
      if (nameError) {
        form.setError("name", { message: tRoot(nameError as never) });
        return;
      }
      toast.error(tRoot(`common.errors.${result.error.code}` as never));
      return;
    }

    toast.success(tag ? t("toast.updated") : t("toast.created"));
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{tag ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
            <DialogDescription>{t("form.description")}</DialogDescription>
          </DialogHeader>

          <Field data-invalid={form.formState.errors.name ? true : undefined}>
            <FieldLabel htmlFor="tag-name">{t("form.name")}</FieldLabel>
            <Input
              id="tag-name"
              autoComplete="off"
              maxLength={40}
              aria-invalid={form.formState.errors.name ? true : undefined}
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <FieldError>{tRoot(form.formState.errors.name.message as never)}</FieldError>
            ) : null}
          </Field>

          <Controller
            control={form.control}
            name="color"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.error ? true : undefined}>
                <FieldLabel>{t("form.color")}</FieldLabel>
                <ColorSwatches value={field.value} onChange={field.onChange} />
                {fieldState.error ? (
                  <FieldError>{tRoot(fieldState.error.message as never)}</FieldError>
                ) : null}
              </Field>
            )}
          />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("form.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t("form.saving") : t("form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
