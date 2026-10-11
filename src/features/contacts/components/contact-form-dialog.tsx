"use client";

import { useState } from "react";
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
import { PhoneInput } from "@/components/ui/phone-input/phone-input";
import { Switch } from "@/components/ui/switch";
import { createContactAction, updateContactAction } from "@/features/contacts/actions";
import { TagPicker } from "@/features/tags/components/tag-picker";
import {
  createContactInputSchema,
  updateContactInputSchema,
  type ContactListRowDTO,
} from "@/lib/validators/contacts";
import type { z } from "@/lib/validators/zod";
import type { TagChipDTO } from "@/lib/validators/tags";
import { useOpenerFocus } from "@/features/clients/components/use-opener-focus";

type ContactFormDialogProps = {
  clientId: string;
  /** Absent for a new contact. */
  contact?: ContactListRowDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateTags: boolean;
  onSaved: () => void;
};

type ContactFormValues = z.input<typeof createContactInputSchema> & { id?: string };

const FIELD_NAMES = ["fullName", "position", "email", "phone", "isPrimary", "tagIds"] as const;

/**
 * Add or edit a contact of a client (HU-04). Same schemas as the actions (C8): a name and at least one of
 * email or phone; marking a contact primary demotes the previous one on the server (CA2).
 */
export function ContactFormDialog(props: ContactFormDialogProps) {
  useOpenerFocus(props.open);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* The form mounts with each opening, so its defaults are read fresh every time. */}
      {props.open ? <ContactForm {...props} /> : null}
    </Dialog>
  );
}

function ContactForm({
  clientId,
  contact,
  onOpenChange,
  canCreateTags,
  onSaved,
}: ContactFormDialogProps) {
  const t = useTranslations("contacts");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const [tags, setTags] = useState<TagChipDTO[]>(contact?.tags ?? []);
  const [saving, setSaving] = useState(false);

  // The edit path runs `updateContactInputSchema` (it needs `id`); the create path runs `createContactInputSchema`.
  // The cast only narrows the union for the resolver's type: both schemas share the field rules, and the form
  // always carries `clientId` and `id`, so each schema finds what it parses.
  const schema = contact ? updateContactInputSchema : createContactInputSchema;
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(schema as typeof createContactInputSchema),
    defaultValues: {
      clientId,
      ...(contact ? { id: contact.id } : {}),
      fullName: contact?.fullName ?? "",
      position: contact?.position ?? "",
      email: contact?.email ?? "",
      phone: contact?.phone ?? "",
      isPrimary: contact?.isPrimary ?? false,
      tagIds: contact ? contact.tags.map((tag) => tag.id) : [],
    },
  });
  const errors = form.formState.errors;
  const fieldMessage = (message: string | undefined) =>
    message ? tRoot(message as never) : undefined;

  async function onSubmit(values: ContactFormValues) {
    setSaving(true);
    const result = contact
      ? await updateContactAction({ ...values, id: contact.id })
      : await createContactAction(values);
    setSaving(false);

    if (!result.ok) {
      const { error } = result;
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        const message = messages[0];
        if (message && (FIELD_NAMES as readonly string[]).includes(field)) {
          form.setError(field as (typeof FIELD_NAMES)[number], {
            message: tRoot(message as never),
          });
        }
      }
      toast.error(tErrors(error.code));
      return;
    }

    toast.success(contact ? t("toast.updated") : t("toast.created"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <DialogContent>
      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{contact ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
          <DialogDescription>{t("form.description")}</DialogDescription>
        </DialogHeader>

        <Field data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor="contact-full-name">{t("form.fields.fullName")}</FieldLabel>
          <Input
            id="contact-full-name"
            aria-invalid={errors.fullName ? true : undefined}
            aria-describedby={errors.fullName ? "contact-full-name-error" : undefined}
            {...form.register("fullName")}
          />
          <FieldError id="contact-full-name-error">
            {fieldMessage(errors.fullName?.message)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.position ? true : undefined}>
          <FieldLabel htmlFor="contact-position">{t("form.fields.position")}</FieldLabel>
          <Input
            id="contact-position"
            aria-invalid={errors.position ? true : undefined}
            aria-describedby={errors.position ? "contact-position-error" : undefined}
            {...form.register("position")}
          />
          <FieldError id="contact-position-error">
            {fieldMessage(errors.position?.message)}
          </FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="contact-email">{t("form.fields.email")}</FieldLabel>
            <Input
              id="contact-email"
              type="email"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "contact-email-error" : undefined}
              {...form.register("email")}
            />
            <FieldError id="contact-email-error">{fieldMessage(errors.email?.message)}</FieldError>
          </Field>

          <Field data-invalid={errors.phone ? true : undefined}>
            <FieldLabel htmlFor="contact-phone">{t("form.fields.phone")}</FieldLabel>
            <Controller
              control={form.control}
              name="phone"
              render={({ field }) => (
                <PhoneInput
                  id="contact-phone"
                  defaultCountry="VE"
                  value={field.value ?? ""}
                  aria-invalid={errors.phone ? true : undefined}
                  onChange={(next) => field.onChange(next)}
                  onBlur={field.onBlur}
                />
              )}
            />
            <FieldError id="contact-phone-error">{fieldMessage(errors.phone?.message)}</FieldError>
          </Field>
        </div>

        <Field>
          <div className="flex items-center justify-between gap-4">
            <FieldLabel htmlFor="contact-primary">{t("form.fields.isPrimary")}</FieldLabel>
            <Controller
              control={form.control}
              name="isPrimary"
              render={({ field }) => (
                <Switch
                  id="contact-primary"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-describedby="contact-primary-hint"
                />
              )}
            />
          </div>
          <FieldDescription id="contact-primary-hint">
            {t("form.fields.isPrimaryHint")}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="contact-tags">{t("form.fields.tags")}</FieldLabel>
          <TagPicker
            id="contact-tags"
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

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            type="button"
          >
            {tActions("cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {tActions("save")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
