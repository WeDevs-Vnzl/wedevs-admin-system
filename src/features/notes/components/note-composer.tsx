"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
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
import {
  attachFileAction,
  createNoteAction,
  pinNoteAction,
  updateNoteAction,
} from "@/features/notes/actions";
import { uploadAdapter } from "@/features/files/upload-adapter";
import { TagPicker } from "@/features/tags/components/tag-picker";
import {
  createNoteInputSchema,
  updateNoteInputSchema,
  type CreateNoteFormValues,
  type NoteDetailDTO,
  type RichTextDoc,
} from "@/lib/validators/notes";
import type { TagChipDTO } from "@/lib/validators/tags";
import { NoteLinkPicker, toNoteLinkRef, type NoteLinkRef } from "./note-link-picker";

export type { NoteLinkRef };

const CONTENT_ERROR_ID = "note-content-error";
const LINKS_ERROR_ID = "note-links-error";
/** Message key of a content the editor refused (an invalid link, an oversize document). */
const CONTENT_INVALID_KEY = "notes.composer.contentInvalid";

/** How the links of the form show: chips only (feed), a picker (new note page) or not at all (detail page). */
type LinkMode = "badges" | "picker" | "none";

const toTarget = (link: NoteLinkRef) => ({ entityType: link.type, entityId: link.id });

/** An edit validates with the update schema: the note's id is the route's, so it is not a form field. */
const editNoteFormSchema = updateNoteInputSchema.omit({ id: true });

/** The form of both modes: an edit has no links to submit (the detail page manages them). */
type NoteFormValues = Omit<CreateNoteFormValues, "links"> & {
  links?: CreateNoteFormValues["links"];
};

interface NoteFormOptions {
  note?: NoteDetailDTO;
  initialLinks?: readonly NoteLinkRef[];
  onSaved?: (note: NoteDetailDTO) => void;
}

interface NoteFormModel {
  form: UseFormReturn<NoteFormValues>;
  tags: TagChipDTO[];
  changeTags: (next: TagChipDTO[]) => void;
  links: NoteLinkRef[];
  addLink: (link: NoteLinkRef) => void;
  removeLink: (link: NoteLinkRef) => void;
  contentChanged: () => void;
  contentRejected: () => void;
  submit: (values: NoteFormValues) => Promise<void>;
}

/**
 * State and save of one note form, shared by the sheet and the full page. Create and edit go through the same
 * Zod schema as the actions. Tags and links are kept beside the form and mirrored into its fields, so the
 * unsaved-changes guard sees them too.
 */
function useNoteForm({ note, initialLinks = [], onSaved }: NoteFormOptions): NoteFormModel {
  const t = useTranslations("notes.composer");
  const tToast = useTranslations("notes.toast");
  const editing = note !== undefined;
  const [links, setLinks] = useState<NoteLinkRef[]>(() =>
    note ? note.links.flatMap((ref) => toNoteLinkRef(ref) ?? []) : [...initialLinks],
  );
  const [tags, setTags] = useState<TagChipDTO[]>(() => note?.tags ?? []);
  // The editor's last accepted value is stale once it reports a refused one: saving stays blocked until it changes.
  const contentRejected = useRef(false);

  const form = useForm<NoteFormValues>({
    resolver: zodResolver(editing ? editNoteFormSchema : createNoteInputSchema),
    defaultValues: {
      title: note?.title ?? "",
      content: note?.content ?? EMPTY_RICH_TEXT,
      links: links.map(toTarget),
      tagIds: tags.map((tag) => tag.id),
      pinned: note?.pinned ?? false,
      attachmentFileIds: [],
    },
  });
  useUnsavedChanges(form.formState.isDirty, t("unsaved"));

  function changeTags(next: TagChipDTO[]) {
    setTags(next);
    form.setValue("tagIds", next.map((tag) => tag.id), { shouldDirty: true });
  }

  function changeLinks(next: NoteLinkRef[]) {
    setLinks(next);
    form.setValue("links", next.map(toTarget), { shouldDirty: true });
  }

  function addLink(link: NoteLinkRef) {
    if (links.some((item) => item.type === link.type && item.id === link.id)) return;
    changeLinks([...links, link]);
  }

  function removeLink(link: NoteLinkRef) {
    changeLinks(links.filter((item) => item.type !== link.type || item.id !== link.id));
  }

  function contentChanged() {
    if (!contentRejected.current) return;
    contentRejected.current = false;
    form.clearErrors("content");
  }

  function contentRejectedNow() {
    contentRejected.current = true;
    form.setError("content", { type: "custom", message: CONTENT_INVALID_KEY });
  }

  /**
   * Saves an edit: the update, then the uploader's new files and the pin. A step that fails shows its error and
   * no success toast; the note still reports what was saved, so the screen shows the stored state.
   */
  async function saveEdit(current: NoteDetailDTO, tagIds: string[]) {
    // The edit schema strips the pin and the files, and reads a cleared title as unset: both come from the raw form.
    const raw = form.getValues();
    const updated = await updateNoteAction({
      id: current.id,
      title: raw.title?.trim() || null,
      content: raw.content,
      tagIds,
    });
    if (!updated.ok) {
      toast.error(tToast("error"));
      return;
    }
    let saved = updated.data;
    let failed = false;
    // New files of the uploader are attached to the existing note one by one.
    for (const fileId of raw.attachmentFileIds ?? []) {
      const attached = await attachFileAction({ noteId: current.id, fileId });
      if (attached.ok) saved = attached.data;
      else {
        failed = true;
        toast.error(tToast("error"));
      }
    }
    if (raw.pinned !== undefined && raw.pinned !== current.pinned) {
      const pinned = await pinNoteAction({ id: current.id, pinned: raw.pinned });
      if (pinned.ok) saved = pinned.data;
      else {
        failed = true;
        toast.error(tToast("error"));
      }
    }
    if (!failed) toast.success(tToast("updated"));
    onSaved?.(saved);
  }

  async function submit(values: NoteFormValues) {
    if (contentRejected.current) {
      form.setError("content", { type: "custom", message: CONTENT_INVALID_KEY });
      return;
    }
    const tagIds = tags.map((tag) => tag.id);
    if (note) {
      await saveEdit(note, tagIds);
      return;
    }
    const title = values.title?.trim() ? values.title.trim() : undefined;
    const result = await createNoteAction({
      ...values,
      links: links.map(toTarget),
      ...(title ? { title } : { title: undefined }),
      tagIds,
    });
    if (!result.ok) {
      toast.error(tToast("error"));
      return;
    }
    toast.success(tToast("created"));
    onSaved?.(result.data);
  }

  return {
    form,
    tags,
    changeTags,
    links,
    addLink,
    removeLink,
    contentChanged,
    contentRejected: contentRejectedNow,
    submit,
  };
}

/** The fields shared by the sheet and the page: title, content, attachments, pin, tags and links. */
function NoteFields({
  model,
  linkMode,
  canCreateTags,
}: {
  model: NoteFormModel;
  linkMode: LinkMode;
  canCreateTags: boolean;
}) {
  const t = useTranslations("notes.composer");
  const tRoot = useTranslations();
  const { form } = model;
  const contentError = form.formState.errors.content;
  const linksError = form.formState.errors.links;

  return (
    <>
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
              aria-describedby={contentError ? CONTENT_ERROR_ID : undefined}
              value={field.value as RichTextDoc}
              onChange={(doc) => {
                model.contentChanged();
                field.onChange(doc);
              }}
              onInvalid={model.contentRejected}
              onBlur={field.onBlur}
              uploadAdapter={uploadAdapter}
            />
          )}
        />
        {contentError?.message ? (
          <FieldError id={CONTENT_ERROR_ID}>{tRoot(contentError.message)}</FieldError>
        ) : null}
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

      <Field>
        <FieldLabel>{t("tagsLabel")}</FieldLabel>
        <TagPicker
          id="note-tags"
          aria-label={t("tagsLabel")}
          value={model.tags}
          onChange={model.changeTags}
          canCreate={canCreateTags}
        />
      </Field>

      {linkMode === "none" ? null : (
        <Field data-invalid={Boolean(linksError) || undefined}>
          <FieldLabel>{t("linksLabel")}</FieldLabel>
          {linkMode === "picker" ? (
            <NoteLinkPicker
              id="note-links"
              value={model.links}
              onAdd={model.addLink}
              onRemove={model.removeLink}
            />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {model.links.length === 0 ? (
                <li className="text-sm text-muted-foreground">{t("noLinks")}</li>
              ) : (
                model.links.map((link) => (
                  <li key={`${link.type}:${link.id}`}>
                    <Badge variant="secondary">{link.label}</Badge>
                  </li>
                ))
              )}
            </ul>
          )}
          {linksError ? (
            <FieldError id={LINKS_ERROR_ID}>{tRoot("validation.required")}</FieldError>
          ) : null}
        </Field>
      )}
    </>
  );
}

export interface NoteComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Records the new note is linked to (prefilled). In edit mode the note's own links are used. */
  links?: readonly NoteLinkRef[];
  /** The note being edited; absent when creating. */
  note?: NoteDetailDTO;
  onSaved?: (note: NoteDetailDTO) => void;
  /** Inline tag creation, computed on the server by the caller (`can(viewer, "create", "note")`). */
  canCreateTags?: boolean;
}

/** Form of one note inside a `sheet`: title, editor, attachments, pinned, tags and the prefilled links. */
export function NoteComposer(props: NoteComposerProps) {
  // The form is keyed by its target so reopening it (or editing another note) starts clean.
  const key = props.note ? `edit:${props.note.id}` : `new:${props.open}`;
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <ComposerSheetForm key={key} {...props} />
      </SheetContent>
    </Sheet>
  );
}

function ComposerSheetForm({
  onOpenChange,
  links = [],
  note,
  onSaved,
  canCreateTags = false,
}: NoteComposerProps) {
  const t = useTranslations("notes.composer");
  const model = useNoteForm({
    note,
    initialLinks: links,
    onSaved: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
  });

  return (
    <form
      onSubmit={model.form.handleSubmit(model.submit)}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <SheetHeader>
        <SheetTitle>{note ? t("editTitle") : t("createTitle")}</SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>

      <FieldGroup className="flex-1 overflow-y-auto px-4 pb-4">
        <NoteFields model={model} linkMode="badges" canCreateTags={canCreateTags} />
      </FieldGroup>

      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={model.form.formState.isSubmitting}>
          {model.form.formState.isSubmitting ? t("saving") : t("submit")}
        </Button>
      </SheetFooter>
    </form>
  );
}

export interface NoteComposerPageProps {
  /** The note being edited; absent on `/notes/new`. */
  note?: NoteDetailDTO;
  /** Links of a new note, prefilled from `?entityType=&entityId=`. */
  initialLinks?: readonly NoteLinkRef[];
  canCreateTags: boolean;
  onSaved?: (note: NoteDetailDTO) => void;
}

/**
 * The composer as a full page form (`/notes/new`), and the editable form of `/notes/[id]`. A new note opens its
 * detail page; an edit refreshes the server page. The links of an existing note are managed by the detail page.
 */
export function NoteComposerPage({
  note,
  initialLinks = [],
  canCreateTags,
  onSaved,
}: NoteComposerPageProps) {
  const t = useTranslations("notes.composer");
  const router = useRouter();
  const model = useNoteForm({
    note,
    initialLinks,
    onSaved: (saved) => {
      if (note) {
        onSaved?.(saved);
        router.refresh();
        return;
      }
      router.replace(`/notes/${encodeURIComponent(saved.id)}`);
    },
  });

  return (
    <form
      onSubmit={model.form.handleSubmit(model.submit)}
      noValidate
      className="flex flex-col gap-6"
    >
      <FieldGroup>
        <NoteFields
          model={model}
          linkMode={note ? "none" : "picker"}
          canCreateTags={canCreateTags}
        />
      </FieldGroup>

      <div className="flex justify-end gap-2 border-t pt-4">
        {note ? null : (
          <Button type="button" variant="outline" onClick={() => router.push("/notes")}>
            {t("cancel")}
          </Button>
        )}
        <Button type="submit" disabled={model.form.formState.isSubmitting}>
          {model.form.formState.isSubmitting ? t("saving") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
