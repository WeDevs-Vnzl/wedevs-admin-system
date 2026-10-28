"use client";

import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { checkUpload, type UploadAdapter } from "@/lib/validators/files";
import { richTextDocSchema, type RichTextDoc } from "@/lib/validators/notes";
import { createRichTextExtensions, normalizeRichTextJson } from "./extensions";
import { richTextProseClassName } from "./prose";
import { RichTextToolbar } from "./rich-text-toolbar";

export const EMPTY_RICH_TEXT: RichTextDoc = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * Normalizes `editor.getJSON()` (null attributes dropped, images reduced to `fileId`/`alt`/`src`) and checks
 * it with `richTextDocSchema`. The editor runs it on every change; forms run their own schema on top.
 */
export function parseRichText(json: unknown): RichTextDoc | null {
  const parsed = richTextDocSchema.safeParse(normalizeRichTextJson(json));
  return parsed.success ? parsed.data : null;
}

export interface RichTextEditorProps {
  /** Current document (controlled initial value; later changes come from the editor). */
  value?: RichTextDoc | null;
  /** Called with the normalized document of every change, already checked with `richTextDocSchema`. */
  onChange?: (value: RichTextDoc) => void;
  /**
   * Called when the current content does not parse (a link the validator refuses, a document over
   * `RICH_TEXT_MAX_BYTES`): the last `onChange` value is stale, so the form must treat the field as invalid.
   */
  onInvalid?: () => void;
  onBlur?: () => void;
  /** Where pasted or dropped images are uploaded (`features/files/upload-adapter.ts`). */
  uploadAdapter?: UploadAdapter;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** Ids of the field description / error; set on the `role="textbox"` element. */
  "aria-describedby"?: string;
  className?: string;
}

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

/**
 * Tiptap editor of the kit (notes, project description). Extensions are exactly the allowlist of the validator
 * (C4), pasted HTML is normalized by that schema, and pasted or dropped images upload through the
 * `UploadAdapter` and become `image` nodes holding only the `fileId`.
 */
export function RichTextEditor({
  value,
  onChange,
  onInvalid,
  onBlur,
  uploadAdapter,
  placeholder,
  disabled = false,
  id,
  className,
  ...aria
}: RichTextEditorProps) {
  const t = useTranslations("forms.richText");
  const adapterRef = useRef(uploadAdapter);
  const changeRef = useRef(onChange);
  const invalidRef = useRef(onInvalid);
  const blurRef = useRef(onBlur);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    adapterRef.current = uploadAdapter;
    changeRef.current = onChange;
    invalidRef.current = onInvalid;
    blurRef.current = onBlur;
  });

  const extensions = useMemo(
    () =>
      createRichTextExtensions({
        placeholder: placeholder ?? t("placeholder"),
        imageLabel: ({ alt }) => t("imagePlaceholder", { name: alt ?? t("imageUnnamed") }),
      }),
    [placeholder, t],
  );

  async function uploadImages(files: File[]) {
    const adapter = adapterRef.current;
    if (!adapter) return;
    for (const file of files) {
      const violation = checkUpload({ name: file.name, mime: file.type, size: file.size }, "general");
      if (violation) {
        toast.error(t("uploadRejected", { name: file.name }));
        continue;
      }
      try {
        const requested = await adapter.requestUpload({
          name: file.name,
          mime: file.type,
          size: file.size,
          context: "general",
        });
        if (!requested.ok) throw new Error(requested.error.code);
        await adapter.put(requested.data, file);
        const confirmed = await adapter.confirmUpload(requested.data.fileId);
        if (!confirmed.ok) throw new Error(confirmed.error.code);
        editorRef.current
          ?.chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: { fileId: confirmed.data.id, alt: confirmed.data.originalName.slice(0, 200) },
          })
          .run();
      } catch {
        toast.error(t("uploadFailed", { name: file.name }));
      }
    }
  }

  // The textbox element carries the field semantics; `attributes` is re-read on every view update.
  const ariaRef = useRef({
    invalid: aria["aria-invalid"],
    describedBy: aria["aria-describedby"],
    label: aria["aria-label"] ?? t("editorLabel"),
  });

  const editor = useEditor(
    {
      extensions,
      content: value ?? EMPTY_RICH_TEXT,
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: () => ({
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": ariaRef.current.label,
          ...(ariaRef.current.invalid ? { "aria-invalid": "true" } : {}),
          ...(ariaRef.current.describedBy
            ? { "aria-describedby": ariaRef.current.describedBy }
            : {}),
          ...(id ? { id } : {}),
          class: "min-h-40 px-3 py-2 outline-none",
        }),
        handlePaste: (_view, event) => {
          const files = imageFiles(event.clipboardData?.files);
          if (files.length === 0) return false;
          event.preventDefault();
          void uploadImages(files);
          return true;
        },
        handleDrop: (_view, event) => {
          const files = imageFiles(event.dataTransfer?.files);
          if (files.length === 0) return false;
          event.preventDefault();
          void uploadImages(files);
          return true;
        },
      },
      onUpdate: ({ editor: current }) => {
        const doc = parseRichText(current.getJSON());
        if (doc) changeRef.current?.(doc);
        else invalidRef.current?.();
      },
      onBlur: () => blurRef.current?.(),
    },
    [extensions],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const invalid = aria["aria-invalid"];
  const describedBy = aria["aria-describedby"];
  const label = aria["aria-label"] ?? t("editorLabel");
  useEffect(() => {
    // Re-evaluates the `attributes` function when the field state changes.
    ariaRef.current = { invalid, describedBy, label };
    if (editor && !editor.isDestroyed) editor.view.setProps({});
  }, [editor, invalid, describedBy, label]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      data-slot="rich-text-editor"
      data-invalid={invalid || undefined}
      className={cn(
        "overflow-hidden rounded-md border border-input bg-background shadow-xs",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        "data-[invalid=true]:border-destructive data-[invalid=true]:ring-destructive/20",
        disabled && "opacity-60",
        className,
      )}
    >
      {editor ? <RichTextToolbar editor={editor} disabled={disabled} /> : null}
      <EditorContent editor={editor} className={richTextProseClassName} />
    </div>
  );
}
