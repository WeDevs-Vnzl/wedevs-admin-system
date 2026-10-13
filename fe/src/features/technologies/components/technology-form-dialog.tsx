"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TECH_CATEGORY_VALUES } from "@/lib/validators/enums";
import {
  createTechnologyInputSchema,
  type TechnologyListRowDTO,
} from "@/lib/validators/technologies";
import { z } from "@/lib/validators/zod";
import { createTechnologyAction, resolveTechnologyIconAction, updateTechnologyAction } from "../actions";
import type { ResolvedIcon } from "./tech-stack-icons";

type FormTarget = { mode: "create" } | { mode: "edit"; technology: TechnologyListRowDTO } | null;

type FormValues = z.input<typeof createTechnologyInputSchema>;

/** The slug the service derives from a name when none is sent (same rule, shown as a preview only). */
function slugPreviewOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("#", "-sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type IconPreview = { status: "idle" } | { status: "found"; icon: ResolvedIcon } | { status: "missing" };

type TechnologyFormDialogProps = {
  target: FormTarget;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

// The form itself. It mounts once per open (see `TechnologyFormDialog`), so its defaults are read once.
function TechnologyForm({ target, onOpenChange, onSaved }: TechnologyFormDialogProps) {
  const t = useTranslations("catalogs.technologies");
  const tRoot = useTranslations();
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const technology = target?.mode === "edit" ? target.technology : null;

  const form = useForm<FormValues>({
    resolver: zodResolver(createTechnologyInputSchema),
    defaultValues: technology
      ? {
          name: technology.name,
          nameEn: technology.nameEn ?? "",
          category: technology.category,
          iconSlug: technology.iconSlug ?? undefined,
          color: technology.color ?? undefined,
          active: technology.active,
        }
      : { name: "", nameEn: "", category: "OTRO", iconSlug: undefined, color: undefined, active: true },
  });

  const name = useWatch({ control: form.control, name: "name" }) ?? "";
  const iconSlug = useWatch({ control: form.control, name: "iconSlug" }) ?? "";
  const color = useWatch({ control: form.control, name: "color" }) ?? "";
  const slugPreview = technology ? technology.slug : slugPreviewOf(name);

  // Live Simple Icons preview: a reference read, debounced so typing does not send a request per key. The result
  // is kept with the slug it answers, so a stale icon never shows for a slug that changed since.
  const [resolved, setResolved] = useState<{ slug: string; preview: IconPreview } | null>(null);
  useEffect(() => {
    if (!iconSlug) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await resolveTechnologyIconAction({ slug: iconSlug });
      if (cancelled) return;
      const preview: IconPreview =
        result.ok && result.data ? { status: "found", icon: result.data } : { status: "missing" };
      setResolved({ slug: iconSlug, preview });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [iconSlug]);
  const iconPreview: IconPreview =
    resolved && resolved.slug === iconSlug ? resolved.preview : { status: "idle" };

  const fieldMessage = (message: string | undefined) => (message ? tRoot(message as never) : undefined);

  async function onSubmit(values: FormValues) {
    const result = technology
      ? await updateTechnologyAction({ ...values, id: technology.id, slug: technology.slug })
      : await createTechnologyAction(values);

    if (!result.ok) {
      const { fieldErrors } = result.error;
      if (fieldErrors) {
        for (const [field, messages] of Object.entries(fieldErrors)) {
          const message = messages[0];
          if (field === "name" || field === "nameEn" || field === "slug" || field === "color" || field === "iconSlug" || field === "category") {
            form.setError(field, { message });
          }
        }
      }
      toast.error(tErrors(result.error.code));
      return;
    }

    toast.success(technology ? t("toast.updated") : t("toast.created"));
    onSaved();
  }

  return (
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{technology ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("form.description")}</DialogDescription>
          </DialogHeader>

          <Field data-invalid={form.formState.errors.name ? true : undefined}>
            <FieldLabel htmlFor="technology-name">{t("form.fields.name")}</FieldLabel>
            <Input
              id="technology-name"
              aria-invalid={form.formState.errors.name ? true : undefined}
              {...form.register("name")}
            />
            <FieldError>{fieldMessage(form.formState.errors.name?.message)}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="technology-name-en">{t("form.fields.nameEn")}</FieldLabel>
            <Input id="technology-name-en" aria-describedby="technology-name-en-hint" {...form.register("nameEn")} />
            <FieldDescription id="technology-name-en-hint">{t("form.fields.nameEnHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="technology-slug">{t("form.fields.slug")}</FieldLabel>
            <Input id="technology-slug" value={slugPreview} readOnly aria-describedby="technology-slug-hint" className="font-mono" />
            <FieldDescription id="technology-slug-hint">{t("form.fields.slugHint")}</FieldDescription>
          </Field>

          <Controller
            control={form.control}
            name="category"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="technology-category">{t("form.fields.category")}</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="technology-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TECH_CATEGORY_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {tEnums(`TechCategory.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{fieldMessage(form.formState.errors.category?.message)}</FieldError>
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="iconSlug"
            render={({ field }) => (
              <Field data-invalid={form.formState.errors.iconSlug ? true : undefined}>
                <FieldLabel htmlFor="technology-icon">{t("form.fields.iconSlug")}</FieldLabel>
                <div className="flex items-center gap-3">
                  <Input
                    id="technology-icon"
                    className="font-mono"
                    placeholder="nextdotjs"
                    aria-describedby="technology-icon-hint technology-icon-preview"
                    aria-invalid={form.formState.errors.iconSlug ? true : undefined}
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value.trim() || undefined)}
                    onBlur={field.onBlur}
                  />
                  <span id="technology-icon-preview" className="flex size-8 shrink-0 items-center justify-center rounded-md border">
                    {iconPreview.status === "found" ? (
                      <svg viewBox="0 0 24 24" className="size-5" fill={`#${iconPreview.icon.hex}`} role="img" aria-label={iconPreview.icon.title}>
                        <path d={iconPreview.icon.path} />
                      </svg>
                    ) : (
                      <span className="text-muted-foreground text-xs" aria-hidden>
                        —
                      </span>
                    )}
                  </span>
                </div>
                <FieldDescription id="technology-icon-hint">
                  {iconPreview.status === "missing" ? t("form.iconNotFound") : t("form.fields.iconSlugHint")}
                </FieldDescription>
                <FieldError>{fieldMessage(form.formState.errors.iconSlug?.message)}</FieldError>
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="color"
            render={({ field }) => (
              <Field data-invalid={form.formState.errors.color ? true : undefined}>
                <FieldLabel htmlFor="technology-color">{t("form.fields.color")}</FieldLabel>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="size-8 shrink-0 rounded-md border"
                    style={color ? { backgroundColor: color } : undefined}
                  />
                  <Input
                    id="technology-color"
                    className="font-mono"
                    placeholder="#RRGGBB"
                    aria-describedby="technology-color-hint"
                    aria-invalid={form.formState.errors.color ? true : undefined}
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value.trim() || undefined)}
                    onBlur={field.onBlur}
                  />
                </div>
                <FieldDescription id="technology-color-hint">{t("form.fields.colorHint")}</FieldDescription>
                <FieldError>{fieldMessage(form.formState.errors.color?.message)}</FieldError>
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="active"
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldLabel htmlFor="technology-active">{t("form.fields.active")}</FieldLabel>
                <Switch id="technology-active" checked={field.value} onCheckedChange={field.onChange} />
              </Field>
            )}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {technology ? t("form.save") : t("form.create")}
            </Button>
          </DialogFooter>
        </form>
  );
}

// Create and edit dialog of the technology catalog. The slug is derived from the name on create and kept on
// edit (it is the identifier). Errors that name a field (`CONFLICT` on name or slug) land on that field.
export function TechnologyFormDialog(props: TechnologyFormDialogProps) {
  const { target, onOpenChange } = props;
  const key = target?.mode === "edit" ? `edit-${target.technology.id}` : target ? "create" : "closed";
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>{target ? <TechnologyForm key={key} {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
