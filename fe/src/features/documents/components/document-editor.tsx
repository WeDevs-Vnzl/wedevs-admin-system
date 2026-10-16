"use client";

import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ColumnsIcon,
  FileWarningIcon,
  HistoryIcon,
  LoaderIcon,
  LockIcon,
  SaveIcon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns/empty-state";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { PrintButton, PrintRegion } from "@/components/patterns/print-view";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useUnsavedChanges } from "@/components/patterns/use-unsaved-changes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { MarkdownView } from "@/components/ui/markdown-view";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DocumentDetailDTO } from "@/lib/validators/documents";
import { cn } from "@/lib/utils";
import { publishDocumentVersionAction } from "../actions";
import { useDraftSave, type SaveState } from "./document-editor-draft";
import type { EditorAvailability } from "./document-editor-state";
import { MarkdownSource, MarkdownToolbar } from "./markdown-editor";
import {
  applyMarkdownFormat,
  countWords,
  cursorPosition,
  type MarkdownFormat,
} from "./markdown-editor-format";

const CHANGELOG_MAX = 500;

type EditorView = "editor" | "split" | "preview";

export interface DocumentEditorProps {
  document: DocumentDetailDTO;
  availability: EditorAvailability;
  /** Draft, else current version, else empty (`initialEditorContent`). */
  initialContent: string;
}

/**
 * `/documents/[id]/editor` (PRD §8.9.3, wireframe 4.9): markdown source and live preview side by side, an
 * explicit "Save draft" (the editor never saves on its own), and "Publicar versión" (version N+1 with an optional change note). A signed
 * document is shown read-only; a file or link document gets an explanatory state instead of the editor.
 */
export function DocumentEditor({ document, availability, initialContent }: DocumentEditorProps) {
  if (availability === "notMarkdown") return <NotMarkdownState documentId={document.id} />;
  return (
    <MarkdownDocumentEditor
      document={document}
      initiallyLocked={availability === "signed"}
      initialContent={initialContent}
    />
  );
}

function NotMarkdownState({ documentId }: { documentId: string }) {
  const t = useTranslations("documentEditor.notMarkdown");
  return (
    <EmptyState
      icon={FileWarningIcon}
      title={t("title")}
      description={t("description")}
      action={
        <Button asChild variant="outline">
          <Link href={`/documents/${documentId}`}>
            <ArrowLeftIcon aria-hidden />
            {t("back")}
          </Link>
        </Button>
      }
    />
  );
}

function MarkdownDocumentEditor({
  document,
  initiallyLocked,
  initialContent,
}: {
  document: DocumentDetailDTO;
  initiallyLocked: boolean;
  initialContent: string;
}) {
  const t = useTranslations("documentEditor");
  const router = useRouter();
  const [locked, setLocked] = useState(initiallyLocked);
  const [content, setContent] = useState(initialContent);
  const [view, setView] = useState<EditorView>("split");
  const [cursor, setCursor] = useState(0);
  const [versionNumber, setVersionNumber] = useState(
    document.currentVersion?.versionNumber ?? null,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lock = useCallback(() => setLocked(true), []);
  const draft = useDraftSave({ documentId: document.id, onLocked: lock });
  useUnsavedChanges(!locked && draft.pending, t("unsaved"));

  const edit = (next: string) => {
    setContent(next);
    draft.change(next);
  };

  const format = (kind: MarkdownFormat) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = applyMarkdownFormat(
      content,
      textarea.selectionStart,
      textarea.selectionEnd,
      kind,
    );
    edit(result.value);
    setCursor(result.selectionEnd);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  const onPublished = (published: DocumentDetailDTO) => {
    draft.markSaved(content);
    setVersionNumber(published.currentVersion?.versionNumber ?? null);
    setPublishOpen(false);
    router.refresh();
  };

  const onLockedByServer = () => {
    setLocked(true);
    setPublishOpen(false);
  };

  const nextVersion = (versionNumber ?? 0) + 1;
  const showSource = !locked && view !== "preview";
  const showPreview = locked || view !== "editor";
  const position = cursorPosition(content, cursor);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link
            href={`/documents/${document.id}`}
            aria-label={t("header.back", { code: document.code })}
          >
            <ArrowLeftIcon aria-hidden />
            {document.code}
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="truncate text-lg font-semibold">{document.title}</h1>
          <EntityCodeChip code={document.code} className="hidden sm:inline-flex" />
          <StatusBadge enumName="DocumentStatus" value={locked ? "FIRMADO" : document.status} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {locked ? null : <SaveIndicator state={draft.state} />}
          <span className="text-sm text-muted-foreground tabular-nums">
            {versionNumber === null
              ? t("header.noVersion")
              : t("header.current", { number: versionNumber })}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={`/documents/${document.id}?tab=versions`}>
              <HistoryIcon aria-hidden />
              {t("header.history")}
            </Link>
          </Button>
          <PrintButton />
          {locked ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={!draft.canSave}
              onClick={() => void draft.save(content)}
            >
              <SaveIcon aria-hidden />
              {t("header.save")}
            </Button>
          )}
          {locked ? null : (
            <Button
              type="button"
              disabled={content.trim() === ""}
              title={content.trim() === "" ? t("publish.empty") : undefined}
              onClick={() => setPublishOpen(true)}
            >
              <UploadIcon aria-hidden />
              {t("header.publish", { number: nextVersion })}
            </Button>
          )}
        </div>
      </header>

      {locked ? (
        <Alert>
          <LockIcon aria-hidden />
          <AlertTitle>{t("locked.title")}</AlertTitle>
          <AlertDescription>{t("locked.description")}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-2 py-1.5">
          <MarkdownToolbar onFormat={format} />
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            aria-label={t("view.label")}
            value={view}
            onValueChange={(value) => {
              if (value) setView(value as EditorView);
            }}
          >
            <ToggleGroupItem value="editor">{t("view.editor")}</ToggleGroupItem>
            <ToggleGroupItem value="split">
              <ColumnsIcon aria-hidden />
              {t("view.split")}
            </ToggleGroupItem>
            <ToggleGroupItem value="preview">{t("view.preview")}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      <div
        className={cn(
          "grid overflow-hidden rounded-xl border bg-card",
          showSource && showPreview && "lg:grid-cols-2",
        )}
      >
        {showSource ? (
          <MarkdownSource
            textareaRef={textareaRef}
            value={content}
            onChange={edit}
            onCursor={setCursor}
            fileName={`${document.code}.md`}
            className={cn(
              "h-[calc(100dvh-20rem)] min-h-[24rem]",
              showPreview && "border-b lg:border-r lg:border-b-0",
            )}
          />
        ) : null}
        {showPreview ? (
          <section
            aria-label={t("preview.label")}
            className="h-[calc(100dvh-20rem)] min-h-[24rem] overflow-y-auto overscroll-contain p-6 lg:p-10"
          >
            <PrintRegion
              title={document.title}
              subtitle={
                versionNumber === null ? document.code : `${document.code} · v${versionNumber}`
              }
            >
              {content.trim() === "" ? (
                <p className="text-sm text-muted-foreground">{t("preview.empty")}</p>
              ) : (
                <MarkdownView content={content} />
              )}
            </PrintRegion>
          </section>
        ) : null}
      </div>

      {locked ? null : (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span className="font-medium text-foreground">{t("statusBar.format")}</span>
          <span>{t("statusBar.words", { count: countWords(content) })}</span>
          <span>{t("statusBar.position", position)}</span>
        </footer>
      )}

      {locked ? null : (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          documentId={document.id}
          content={content}
          nextVersion={nextVersion}
          onPublished={onPublished}
          onLocked={onLockedByServer}
        />
      )}
    </div>
  );
}

const SAVE_STATE_ICONS = {
  idle: CircleCheckIcon,
  saved: CircleCheckIcon,
  dirty: CircleDotIcon,
  saving: LoaderIcon,
  error: CircleAlertIcon,
} as const;

function SaveIndicator({ state }: { state: SaveState }) {
  const t = useTranslations("documentEditor.saveState");
  const Icon = SAVE_STATE_ICONS[state];
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground",
        state === "error" && "text-destructive",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4",
          state === "saving" && "motion-safe:animate-spin",
          (state === "idle" || state === "saved") && "text-success-foreground",
        )}
      />
      {t(state)}
    </span>
  );
}

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  content: string;
  nextVersion: number;
  onPublished: (document: DocumentDetailDTO) => void;
  onLocked: () => void;
}

function PublishDialog({
  open,
  onOpenChange,
  documentId,
  content,
  nextVersion,
  onPublished,
  onLocked,
}: PublishDialogProps) {
  const t = useTranslations("documentEditor.publish");
  const tRoot = useTranslations();
  const [changelog, setChangelog] = useState("");
  const [changelogError, setChangelogError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const publish = async () => {
    setPending(true);
    setChangelogError(null);
    const note = changelog.trim();
    const result = await publishDocumentVersionAction({
      documentId,
      content,
      ...(note ? { changelog: note } : {}),
    });
    setPending(false);
    if (result.ok) {
      setChangelog("");
      toast.success(
        t("success", { number: result.data.currentVersion?.versionNumber ?? nextVersion }),
      );
      onPublished(result.data);
      return;
    }
    if (result.error.code === "INTEGRITY_LOCK") {
      toast.error(tRoot("documentEditor.locked.title"));
      onLocked();
      return;
    }
    const fieldError = result.error.fieldErrors?.changelog?.[0];
    if (fieldError) {
      setChangelogError(tRoot.has(fieldError) ? tRoot(fieldError) : t("failed"));
      return;
    }
    toast.error(t("failed"));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title", { number: nextVersion })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Field data-invalid={changelogError ? true : undefined}>
          <FieldLabel htmlFor="document-editor-changelog">{t("changelog")}</FieldLabel>
          <Textarea
            id="document-editor-changelog"
            value={changelog}
            maxLength={CHANGELOG_MAX}
            aria-invalid={changelogError ? true : undefined}
            onChange={(event) => setChangelog(event.target.value)}
          />
          <FieldDescription>{t("changelogHint")}</FieldDescription>
          {changelogError ? <FieldError>{changelogError}</FieldError> : null}
        </Field>
        <DialogFooter>
          <Button type="button" disabled={pending} onClick={() => void publish()}>
            {pending ? t("publishing") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
