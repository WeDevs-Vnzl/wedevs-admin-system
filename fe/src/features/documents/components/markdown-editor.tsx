"use client";

import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  type LucideIcon,
  QuoteIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TableIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { MarkdownFormat } from "./markdown-editor-format";

/** Toolbar groups of wireframe 4.9: headings · inline marks · link · lists · blocks. */
const TOOLBAR_GROUPS: ReadonlyArray<ReadonlyArray<[MarkdownFormat, LucideIcon]>> = [
  [
    ["h1", Heading1Icon],
    ["h2", Heading2Icon],
    ["h3", Heading3Icon],
  ],
  [
    ["bold", BoldIcon],
    ["italic", ItalicIcon],
    ["strike", StrikethroughIcon],
    ["code", CodeIcon],
  ],
  [["link", LinkIcon]],
  [
    ["bulletList", ListIcon],
    ["orderedList", ListOrderedIcon],
    ["taskList", ListChecksIcon],
  ],
  [
    ["table", TableIcon],
    ["quote", QuoteIcon],
    ["codeBlock", SquareCodeIcon],
  ],
];

/** Formatting buttons over the markdown source; each one calls `onFormat` with its transform. */
export function MarkdownToolbar({ onFormat }: { onFormat: (format: MarkdownFormat) => void }) {
  const t = useTranslations("documentEditor.toolbar");
  return (
    <div role="toolbar" aria-label={t("label")} className="flex flex-wrap items-center gap-0.5">
      {TOOLBAR_GROUPS.map((group, index) => (
        <Fragment key={group[0]![0]}>
          {index > 0 ? <Separator orientation="vertical" className="mx-1 h-5" /> : null}
          {group.map(([format, Icon]) => (
            <Button
              key={format}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t(format)}
              title={t(format)}
              // Keep the textarea's selection: the button never takes focus on press.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onFormat(format)}
            >
              <Icon aria-hidden />
            </Button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

interface MarkdownSourceProps {
  value: string;
  onChange: (value: string) => void;
  onCursor: (offset: number) => void;
  fileName: string;
  textareaRef: Ref<HTMLTextAreaElement>;
  className?: string;
}

/** The source pane: file name bar and a monospace textarea (tab key left to focus navigation). */
export function MarkdownSource({
  value,
  onChange,
  onCursor,
  fileName,
  textareaRef,
  className,
}: MarkdownSourceProps) {
  const t = useTranslations("documentEditor.source");
  return (
    <div className={cn("flex min-h-0 flex-col bg-muted/40", className)}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2 font-mono text-xs text-muted-foreground">
        <span className="truncate">{fileName}</span>
        <span className="shrink-0">{t("format")}</span>
      </div>
      <textarea
        ref={textareaRef}
        aria-label={t("label")}
        value={value}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
          onCursor(event.target.selectionStart);
        }}
        onSelect={(event) => onCursor(event.currentTarget.selectionStart)}
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      />
    </div>
  );
}
