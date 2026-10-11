"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RichTextEditor, EMPTY_RICH_TEXT } from "@/components/ui/rich-text";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Uploader } from "@/components/ui/uploader";
import { useUnsavedChanges } from "@/components/patterns/use-unsaved-changes";
import { attachFileAction, createNoteAction, updateNoteAction } from "@/features/notes/actions";
import { uploadAdapter } from "@/features/files/upload-adapter";
import type { EntityRef } from "@/lib/validators/common";
import {
  createNoteInputSchema,
  type CreateNoteFormValues,
  type NoteDetailDTO,
  type NoteLinkEntityType,
  type RichTextDoc,
} from "@/lib/validators/notes";

/** A record the note hangs from (a `NoteLinkEntityType` ref: client, contact, project, document…). */
export type NoteLinkRef = Pick<EntityRef, "id" | "label"> & { type: NoteLinkEntityType };

export interface NoteComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Records the new note is linked to (prefilled). In edit mode the note's own links are used. */
  links?: readonly NoteLinkRef[];
  /** The note being edited; absent when creating. */
  note?: NoteDetailDTO;
  onSaved?: (note: NoteDetailDTO) => void;
}

const LINK_TYPES: readonly string[] = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "DOCUMENT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
];

function toLinkRef(ref: EntityRef): NoteLinkRef | null {
  return LINK_TYPES.includes(ref.type)
    ? { id: ref.id, label: ref.label, type: ref.type as NoteLinkEntityType }
    : null;
}

/** Form of one note inside a `sheet`: title, editor, attachments, pinned and the prefilled links. */
export function NoteComposer(props: NoteComposerProps) {
  // The form is keyed by its target so reopening it (or editing another note) starts clean.
  const key = props.note ? `edit:${props.note.id}` : `new:${props.open}`;
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <ComposerForm key={key} {...props} />
      </SheetContent>
    </Sheet>
  );
}

function ComposerForm({ onOpenChange, links = [], note, onSaved }: NoteComposerProps) {
  const t = useTranslations("notes.composer");
  const tToast = useTranslations("notes.toast");
  const tRoot = useTranslations();
  const editing = note !== undefined;
  const linkRefs: readonly NoteLinkRef[] = note
    ? note.links.flatMap((ref) => toLinkRef(ref) ?? [])
    : links;

  const form = useForm<CreateNoteFormValues>({
    resolver: zodResolver(createNoteInputSchema),
    defaultValues: {
      title: note?.title ?? "",
      content: note?.content ?? EMPTY_RICH_TEXT,
      links: linkRefs.map((link) => ({ entityType: link.type, entityId: link.id })),
      tagIds: note?.tags.map((tag) => tag.id) ?? [],
      pinned: note?.pinned ?? false,
      attachmentFileIds: [],
    },
  });
  useUnsavedChanges(form.formState.isDirty, t("unsaved"));

  async function onSubmit(values: CreateNoteFormValues) {
    const title = values.title?.trim() ? values.title.trim() : undefined;
    const result = note
      ? await updateNoteAction({
          id: note.id,
          ...(title ? { title } : {}),
          content: values.content,
          tagIds: values.tagIds ?? [],
        })
      : await createNoteAction({ ...values, ...(title ? { title } : { title: undefined }) });
    if (!result.ok) {
      toast.error(tToast("error"));
      return;
    }
    let saved = result.data;
    if (note) {
      // New files of the uploader are attached to the existing note one by one.
      for (const fileId of values.attachmentFileIds ?? []) {
        const attached = await attachFileAction({ noteId: note.id, fileId });
        if (attached.ok) saved = attached.data;
        else toast.error(tToast("error"));
      }
    }
    toast.success(editing ? tToast("updated") : tToast("created"));
    onSaved?.(saved);
    onOpenChange(false);
  }

  const contentError = form.formState.errors.content;
  const linksError = form.formState.errors.links;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <SheetHeader>
        <SheetTitle>{editing ? t("editTitle") : t("createTitle")}</SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>

      <FieldGroup className="flex-1 overflow-y-auto px-4 pb-4">
        <Field>
          <FieldLabel htmlFor="note-title">{t("titleLabel")}</FieldLabel>
          <Input
            id="note-title"
            maxLength={200}
            placeholder={t("titlePlaceholder")}
            {...form.register("title")}
          />
        </Field>

        <Field data-invalid={Boolean(contentError) || undefined}>
          <FieldLabel htmlFor="note-content">{t("contentLabel")}</FieldLabel>
          <Controller
            control={form.control}
            name="content"
            render={({ field }) => (
              <RichTextEditor
                id="note-content"
                aria-label={t("contentLabel")}
                aria-invalid={Boolean(contentError)}
                value={field.value as RichTextDoc}
                onChange={field.onChange}
                onBlur={field.onBlur}
                uploadAdapter={uploadAdapter}
              />
            )}
          />
          {contentError?.message ? <FieldError>{tRoot(contentError.message)}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel>{t("attachmentsLabel")}</FieldLabel>
          <Controller
            control={form.control}
            name="attachmentFileIds"
            render={({ field }) => (
              <Uploader
                adapter={uploadAdapter}
                context="general"
                aria-label={t("attachmentsLabel")}
                onChange={(files) => field.onChange(files.map((file) => file.id))}
              />
            )}
          />
        </Field>

        <Field orientation="horizontal">
          <Controller
            control={form.control}
            name="pinned"
            render={({ field }) => (
              <Switch
                id="note-pinned"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <FieldLabel htmlFor="note-pinned" className="font-normal">
            {t("pinnedLabel")}
          </FieldLabel>
        </Field>

        <Field data-invalid={Boolean(linksError) || undefined}>
          <FieldLabel>{t("linksLabel")}</FieldLabel>
          <ul className="flex flex-wrap gap-2">
            {linkRefs.length === 0 ? (
              <li className="text-sm text-muted-foreground">{t("noLinks")}</li>
            ) : (
              linkRefs.map((link) => (
                <li key={`${link.type}:${link.id}`}>
                  <Badge variant="secondary">{link.label}</Badge>
                </li>
              ))
            )}
          </ul>
          {linksError ? <FieldError>{tRoot("validation.required")}</FieldError> : null}
        </Field>
      </FieldGroup>

      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t("saving") : t("submit")}
        </Button>
      </SheetFooter>
    </form>
  );
}
