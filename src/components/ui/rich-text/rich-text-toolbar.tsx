"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  BoldIcon,
  CodeIcon,
  FileCodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  StrikethroughIcon,
  TableIcon,
  Undo2Icon,
  UnlinkIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isAllowedRichTextUri } from "./extensions";

type Icon = ComponentType<{ className?: string }>;

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ToggleButton(props: {
  label: string;
  icon: Icon;
  pressed: boolean;
  disabled?: boolean;
  onPressedChange: () => void;
}) {
  const Glyph = props.icon;
  return (
    <Tip label={props.label}>
      <Toggle
        size="sm"
        aria-label={props.label}
        pressed={props.pressed}
        disabled={props.disabled}
        onPressedChange={props.onPressedChange}
      >
        <Glyph />
      </Toggle>
    </Tip>
  );
}

function ActionButton(props: {
  label: string;
  icon: Icon;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Glyph = props.icon;
  return (
    <Tip label={props.label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={props.label}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        <Glyph />
      </Button>
    </Tip>
  );
}

function LinkControl({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const t = useTranslations("forms.richText.toolbar");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [invalid, setInvalid] = useState(false);
  const active = editor.isActive("link");

  function apply() {
    const href = url.trim();
    if (!isAllowedRichTextUri(href)) {
      setInvalid(true);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setUrl(String(editor.getAttributes("link").href ?? ""));
          setInvalid(false);
        }
      }}
    >
      <Tip label={t("link")}>
        <PopoverTrigger asChild>
          <Toggle size="sm" aria-label={t("link")} pressed={active} disabled={disabled}>
            <LinkIcon />
          </Toggle>
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="flex w-80 flex-col gap-2">
        <Input
          value={url}
          type="url"
          inputMode="url"
          placeholder={t("linkPlaceholder")}
          aria-label={t("linkUrl")}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
        {invalid ? (
          <p role="alert" className="text-xs text-destructive">
            {t("linkInvalid")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" onClick={apply}>
            {t("linkApply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Formatting toolbar of `RichTextEditor`: registry toggle / button-group / separator / tooltip, i18n labels. */
export function RichTextToolbar({ editor, disabled = false }: { editor: Editor; disabled?: boolean }) {
  const t = useTranslations("forms.richText.toolbar");
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      h1: current.isActive("heading", { level: 1 }),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      taskList: current.isActive("taskList"),
      blockquote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      link: current.isActive("link"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const run = () => editor.chain().focus();

  return (
    <TooltipProvider>
      <div
        role="toolbar"
        aria-label={t("label")}
        className="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1"
      >
        <ButtonGroup>
          <ToggleButton label={t("bold")} icon={BoldIcon} pressed={state.bold} disabled={disabled} onPressedChange={() => run().toggleBold().run()} />
          <ToggleButton label={t("italic")} icon={ItalicIcon} pressed={state.italic} disabled={disabled} onPressedChange={() => run().toggleItalic().run()} />
          <ToggleButton label={t("strike")} icon={StrikethroughIcon} pressed={state.strike} disabled={disabled} onPressedChange={() => run().toggleStrike().run()} />
          <ToggleButton label={t("code")} icon={CodeIcon} pressed={state.code} disabled={disabled} onPressedChange={() => run().toggleCode().run()} />
        </ButtonGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ButtonGroup>
          <ToggleButton label={t("heading1")} icon={Heading1Icon} pressed={state.h1} disabled={disabled} onPressedChange={() => run().toggleHeading({ level: 1 }).run()} />
          <ToggleButton label={t("heading2")} icon={Heading2Icon} pressed={state.h2} disabled={disabled} onPressedChange={() => run().toggleHeading({ level: 2 }).run()} />
          <ToggleButton label={t("heading3")} icon={Heading3Icon} pressed={state.h3} disabled={disabled} onPressedChange={() => run().toggleHeading({ level: 3 }).run()} />
        </ButtonGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ButtonGroup>
          <ToggleButton label={t("bulletList")} icon={ListIcon} pressed={state.bulletList} disabled={disabled} onPressedChange={() => run().toggleBulletList().run()} />
          <ToggleButton label={t("orderedList")} icon={ListOrderedIcon} pressed={state.orderedList} disabled={disabled} onPressedChange={() => run().toggleOrderedList().run()} />
          <ToggleButton label={t("taskList")} icon={ListChecksIcon} pressed={state.taskList} disabled={disabled} onPressedChange={() => run().toggleTaskList().run()} />
        </ButtonGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ButtonGroup>
          <ToggleButton label={t("blockquote")} icon={QuoteIcon} pressed={state.blockquote} disabled={disabled} onPressedChange={() => run().toggleBlockquote().run()} />
          <ToggleButton label={t("codeBlock")} icon={FileCodeIcon} pressed={state.codeBlock} disabled={disabled} onPressedChange={() => run().toggleCodeBlock().run()} />
          <ActionButton label={t("horizontalRule")} icon={MinusIcon} disabled={disabled} onClick={() => run().setHorizontalRule().run()} />
          <ActionButton label={t("table")} icon={TableIcon} disabled={disabled} onClick={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        </ButtonGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ButtonGroup>
          <LinkControl editor={editor} disabled={disabled} />
          <ActionButton label={t("unlink")} icon={UnlinkIcon} disabled={disabled || !state.link} onClick={() => run().unsetLink().run()} />
        </ButtonGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ButtonGroup>
          <ActionButton label={t("undo")} icon={Undo2Icon} disabled={disabled || !state.canUndo} onClick={() => run().undo().run()} />
          <ActionButton label={t("redo")} icon={Redo2Icon} disabled={disabled || !state.canRedo} onClick={() => run().redo().run()} />
        </ButtonGroup>
      </div>
    </TooltipProvider>
  );
}
