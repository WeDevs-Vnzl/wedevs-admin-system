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
  onBlur?: () => void;
  /** Where pasted or dropped images are uploaded (`features/files/upload-adapter.ts`). */
  uploadAdapter?: UploadAdapter;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
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
  const blurRef = useRef(onBlur);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    adapterRef.current = uploadAdapter;
    changeRef.current = onChange;
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

  const editor = useEditor(
    {
      extensions,
      content: value ?? EMPTY_RICH_TEXT,
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": aria["aria-label"] ?? t("editorLabel"),
          ...(id ? { id } : {}),
          class: "min-h-40 px-3 py-2 outline-none",
        },
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
      },
      onBlur: () => blurRef.current?.(),
    },
    [extensions],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      data-slot="rich-text-editor"
      aria-invalid={aria["aria-invalid"] || undefined}
      className={cn(
        "overflow-hidden rounded-md border border-input bg-background shadow-xs",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        disabled && "opacity-60",
        className,
      )}
    >
      {editor ? <RichTextToolbar editor={editor} disabled={disabled} /> : null}
      <EditorContent editor={editor} className={richTextProseClassName} />
    </div>
  );
}
