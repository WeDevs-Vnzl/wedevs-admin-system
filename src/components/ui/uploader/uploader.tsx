"use client";

import { useRef, useState, type DragEvent } from "react";
import { CloudUploadIcon, FileTextIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  checkUpload,
  getUploadRules,
  type FileDTO,
  type UploadAdapter,
  type UploadContext,
} from "@/lib/validators/files";

export interface UploaderProps {
  /** The only way the uploader reaches storage (mock adapter in Hito 1, presigned in Hito 2). */
  adapter: UploadAdapter;
  /** Decides the allowlist and the size limit: 25 MB general, 10 MB payment receipts (C23). */
  context: UploadContext;
  /** Accepts several files (default) or keeps only the latest one. */
  multiple?: boolean;
  /** Files already attached (edit forms). */
  defaultFiles?: readonly FileDTO[];
  /** Called with the confirmed files whenever one is added or removed. */
  onChange?: (files: FileDTO[]) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

type ItemStatus = "uploading" | "done" | "error" | "rejected";

interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: ItemStatus;
  /** Fraction between 0 and 1. */
  progress: number;
  file?: FileDTO;
  /** i18n key (+ values) of the problem, for `rejected` and `error`. */
  error?: { key: string; values?: { max: number } };
}

const KB = 1024;
const MB = KB * KB;

function formatBytes(bytes: number, locale: string): string {
  const [unit, factor] =
    bytes >= MB ? (["megabyte", MB] as const) : bytes >= KB ? (["kilobyte", KB] as const) : (["byte", 1] as const);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / factor);
}

function fileDtoToItem(file: FileDTO): UploadItem {
  return {
    id: `file-${file.id}`,
    name: file.originalName,
    size: file.sizeBytes,
    status: "done",
    progress: 1,
    file,
  };
}

/**
 * Drop zone + file list (wireframe 4.6). Validates each file against the context's allowlist and size
 * limit before anything leaves the browser, then drives the `UploadAdapter` (request → put → confirm).
 * It has no network code of its own.
 */
export function Uploader({
  adapter,
  context,
  multiple = true,
  defaultFiles = [],
  onChange,
  disabled,
  id,
  className,
  ...aria
}: UploaderProps) {
  const t = useTranslations();
  const locale = useLocale();
  const rules = getUploadRules(context);

  const [items, setItems] = useState<UploadItem[]>(() => defaultFiles.map(fileDtoToItem));
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const aborters = useRef(new Map<string, AbortController>());
  const confirmed = useRef<FileDTO[]>([...defaultFiles]);

  const patch = (itemId: string, changes: Partial<UploadItem>) =>
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...changes } : item)));

  function publish(next: FileDTO[]) {
    confirmed.current = next;
    onChange?.(next);
  }

  function translateError(key: string, values?: { max: number }): string {
    return t.has(key) ? t(key, values) : t("forms.uploader.failed");
  }

  async function upload(file: File, itemId: string) {
    const controller = new AbortController();
    aborters.current.set(itemId, controller);
    const fail = (key: string) => patch(itemId, { status: "error", error: { key } });
    try {
      const requested = await adapter.requestUpload({
        name: file.name,
        mime: file.type,
        size: file.size,
        context,
      });
      if (controller.signal.aborted) return;
      if (!requested.ok) return fail(requested.error.message);

      await adapter.put(requested.data, file, {
        signal: controller.signal,
        onProgress: (fraction) => patch(itemId, { progress: fraction }),
      });
      if (controller.signal.aborted) return;

      const result = await adapter.confirmUpload(requested.data.fileId);
      if (controller.signal.aborted) return;
      if (!result.ok) return fail(result.error.message);

      patch(itemId, { status: "done", progress: 1, file: result.data });
      publish([...confirmed.current, result.data]);
    } catch {
      if (!controller.signal.aborted) fail("forms.uploader.failed");
    } finally {
      aborters.current.delete(itemId);
    }
  }

  function addFiles(list: FileList | File[]) {
    if (disabled) return;
    const incoming = multiple ? [...list] : [...list].slice(0, 1);
    if (incoming.length === 0) return;
    if (!multiple) clearAll();

    const added: UploadItem[] = [];
    const accepted: { file: File; itemId: string }[] = [];
    for (const file of incoming) {
      const itemId = `local-${counter.current++}`;
      const violation = checkUpload({ name: file.name, mime: file.type, size: file.size }, context);
      added.push({
        id: itemId,
        name: file.name,
        size: file.size,
        status: violation ? "rejected" : "uploading",
        progress: 0,
        error: violation ? { key: violation.key, values: "values" in violation ? violation.values : undefined } : undefined,
      });
      if (!violation) accepted.push({ file, itemId });
    }
    setItems((current) => [...(multiple ? current : []), ...added]);
    for (const { file, itemId } of accepted) void upload(file, itemId);
  }

  function clearAll() {
    for (const controller of aborters.current.values()) controller.abort();
    aborters.current.clear();
    if (confirmed.current.length > 0) publish([]);
  }

  function remove(item: UploadItem) {
    aborters.current.get(item.id)?.abort();
    setItems((current) => current.filter((other) => other.id !== item.id));
    if (item.file) publish(confirmed.current.filter((file) => file.id !== item.file?.id));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const maxMb = rules.maxBytes / MB;
  const types = rules.allowedExtensions.map((ext) => ext.slice(1).toUpperCase()).join(", ");

  return (
    <div data-slot="uploader" className={cn("flex flex-col gap-3", className)}>
      <div
        data-slot="uploader-dropzone"
        data-dragging={dragging || undefined}
        aria-disabled={disabled || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border border-dashed border-input px-4 py-8 text-center transition-colors",
          "data-[dragging=true]:border-ring data-[dragging=true]:bg-muted aria-disabled:opacity-50",
        )}
      >
        <CloudUploadIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">{dragging ? t("forms.uploader.dropActive") : t("forms.uploader.dropTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("forms.uploader.hint", { max: maxMb, types })}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {t("forms.uploader.browse")}
        </Button>
        <input
          ref={inputRef}
          id={id}
          type="file"
          className="sr-only"
          tabIndex={-1}
          multiple={multiple}
          disabled={disabled}
          accept={[...rules.allowedExtensions, ...rules.allowedMimeTypes].join(",")}
          aria-label={aria["aria-label"] ?? t("forms.uploader.inputLabel")}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {items.length > 0 ? (
        <ul aria-label={t("forms.uploader.listLabel")} aria-live="polite" className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              data-status={item.status}
              className="flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(item.size, locale)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled}
                  aria-label={t("forms.uploader.remove", { name: item.name })}
                  onClick={() => remove(item)}
                >
                  <XIcon />
                </Button>
              </div>
              {item.status === "uploading" ? (
                <Progress
                  value={Math.round(item.progress * 100)}
                  aria-label={t("forms.uploader.uploading", { name: item.name })}
                />
              ) : null}
              {item.status === "done" ? (
                <p className="text-xs text-muted-foreground">{t("forms.uploader.done")}</p>
              ) : null}
              {item.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {translateError(item.error.key, item.error.values)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
