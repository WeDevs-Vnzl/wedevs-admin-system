"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { Uploader } from "@/components/ui/uploader/uploader";
import { attachInvoiceFileAction } from "@/features/invoices/actions";
import { uploadAdapter } from "@/features/files/upload-adapter";
import { fileDownloadPath } from "@/lib/api/file-url";
import type { InvoiceResponseDto } from "@/lib/api/types/invoices";
import { fileDtoSchema, type FileDTO } from "@/lib/validators/files";

type InvoiceFilePanelProps = {
  invoiceId: string;
  file: InvoiceResponseDto["file"];
  canUpdate: boolean;
};

/**
 * The "Archivo" tab (HU-11 CA4, HU-14 CA1): attaches the PDF of the real invoice through the upload adapter
 * (the BE-issued signed params, C23) and links it through `fileDownloadPath`, the FE route that relays the BE's
 * signed redirect. `PUT /invoices/{id}/file` takes the confirmed `fileId`.
 */
export function InvoiceFilePanel({ invoiceId, file, canUpdate }: InvoiceFilePanelProps) {
  const t = useTranslations("invoices.file");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // The kit's `FileDTO` has an enumerated status; a row it cannot read is left out of the uploader.
  const current = file ? fileDtoSchema.safeParse(file) : null;
  const uploaded: FileDTO[] = current?.success ? [current.data] : [];

  async function onChange(files: FileDTO[]) {
    setSaving(true);
    const next = files[0] ?? null;
    const result = await attachInvoiceFileAction({ id: invoiceId, fileId: next?.id ?? null });
    setSaving(false);
    if (!result.ok) {
      toast.error(t("errors.attach"));
      return;
    }
    toast.success(next ? t("toast.attached") : t("toast.detached"));
    router.refresh();
  }

  return (
    <SectionCard title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        {file ? (
          <div className="flex flex-col gap-2">
            {file.mimeType === "application/pdf" ? (
              <PdfViewer
                url={fileDownloadPath(file.id)}
                onDownload={() => window.location.assign(fileDownloadPath(file.id))}
                className="h-[560px]"
              />
            ) : null}
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t("fields.name")}</dt>
                <dd className="break-all">{file.originalName}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t("fields.size")}</dt>
                <dd>{formatSize(file.sizeBytes)}</dd>
              </div>
            </dl>
            <div>
              <Button variant="outline" size="sm" asChild>
                <a href={fileDownloadPath(file.id)} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden />
                  {t("open")}
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {canUpdate ? (
          <Uploader
            adapter={uploadAdapter}
            context="general"
            multiple={false}
            defaultFiles={uploaded}
            onChange={(files) => void onChange(files)}
            disabled={saving}
            aria-label={t("uploadLabel")}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
