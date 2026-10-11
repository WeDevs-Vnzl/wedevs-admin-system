"use client";

import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { richTextDocSchema, type RichTextDoc } from "@/lib/validators/notes";
import { createRichTextExtensions } from "./extensions";
import { richTextProseClassName } from "./prose";

export interface RichTextViewProps {
  /** A stored Tiptap document. It is checked against the allowlist schema before it reaches the DOM (C4). */
  content: RichTextDoc;
  className?: string;
}

/**
 * Read-only renderer of a rich-text document (C4): Tiptap with the same extension allowlist as the editor,
 * never `dangerouslySetInnerHTML`. A document that does not pass `richTextDocSchema` is not rendered. Images
 * render as an attachment placeholder with the file name; links open in a new tab with
 * `rel="noopener noreferrer nofollow"`.
 */
export function RichTextView({ content, className }: RichTextViewProps) {
  const t = useTranslations("forms.richText");
  const checked = useMemo(() => richTextDocSchema.safeParse(content), [content]);
  const extensions = useMemo(
    () =>
      createRichTextExtensions({
        imageLabel: ({ alt }) => t("imagePlaceholder", { name: alt ?? t("imageUnnamed") }),
      }),
    [t],
  );

  const editor = useEditor(
    {
      extensions,
      content: checked.success ? checked.data : undefined,
      editable: false,
      immediatelyRender: false,
      editorProps: { attributes: { role: "document", "aria-label": t("viewLabel") } },
    },
    [extensions],
  );

  useEffect(() => {
    if (editor && checked.success) editor.commands.setContent(checked.data, { emitUpdate: false });
  }, [editor, checked]);

  if (!checked.success) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {t("invalid")}
      </p>
    );
  }
  return (
    <EditorContent
      editor={editor}
      data-slot="rich-text-view"
      className={cn(richTextProseClassName, className)}
    />
  );
}
