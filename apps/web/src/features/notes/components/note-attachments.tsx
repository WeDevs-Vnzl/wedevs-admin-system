"use client";

import { PaperclipIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { fileDownloadPath } from "@/lib/api/file-url";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { FileDTO } from "@/lib/validators/files";

const KB = 1024;
const MB = KB * KB;

function formatBytes(bytes: number, locale: string): string {
  const [unit, factor] =
    bytes >= MB
      ? (["megabyte", MB] as const)
      : bytes >= KB
        ? (["kilobyte", KB] as const)
        : (["byte", 1] as const);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / factor);
}

/**
 * Attachment chips of a note: a composition of the installed `badge` and `tooltip` (the registry `attachment`
 * item is not installed, W2 decision). A chip downloads through `fileDownloadPath` (the FE route that proxies the
 * BE's signed redirect, C23); the BE answers 404 for a file that is not confirmed.
 */
export function NoteAttachments({ files }: { files: readonly FileDTO[] }) {
  const t = useTranslations("notes.attachments");
  const locale = useLocale();
  if (files.length === 0) return null;
  return (
    <TooltipProvider>
      <ul aria-label={t("label")} className="flex flex-wrap gap-2">
        {files.map((file) => (
          <li key={file.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge asChild variant="outline" className="max-w-56 gap-1.5 font-normal">
                  <a href={fileDownloadPath(file.id)}>
                    <PaperclipIcon aria-hidden className="size-3 shrink-0" />
                    <span className="truncate">{file.originalName}</span>
                  </a>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t("size", { name: file.originalName, size: formatBytes(file.sizeBytes, locale) })}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}
