"use client";

import { PaperclipIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
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
 * item is not installed, W2 decision). Hito 1 has no download URL, so a chip is a label, not a link.
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
                <Badge variant="outline" tabIndex={0} className="max-w-56 gap-1.5 font-normal">
                  <PaperclipIcon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{file.originalName}</span>
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
