"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SectionCard } from "@/components/patterns/section-card";
import { Uploader } from "@/components/ui/uploader/uploader";
import { attachInvoiceFileAction } from "@/features/invoices/actions";
import { uploadAdapter } from "@/features/files/upload-adapter";
import type { FileDTO } from "@/lib/validators/files";

type InvoiceFilePanelProps = {
  invoiceId: string;
  file: FileDTO | null;
  canUpdate: boolean;
};

/**
 * The "Archivo" tab (HU-11 CA4, HU-14 CA1): attaches the PDF of the real invoice through the mock upload adapter and
 * shows what is attached. The mock has no bytes to preview, so the preview itself waits for the real storage (H2).
 */
export function InvoiceFilePanel({ invoiceId, file, canUpdate }: InvoiceFilePanelProps) {
  const t = useTranslations("invoices.file");
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onChange(files: FileDTO[]) {
    setSaving(true);
    const current = files[0] ?? null;
    const result = await attachInvoiceFileAction({ id: invoiceId, fileId: current?.id ?? null });
    setSaving(false);
    if (!result.ok) {
      toast.error(t("errors.attach"));
      return;
    }
    toast.success(current ? t("toast.attached") : t("toast.detached"));
    router.refresh();
  }

  return (
    <SectionCard title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        {file ? (
          <div className="flex flex-col gap-2">
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
            <p className="text-xs text-muted-foreground">{t("previewUnavailable")}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {canUpdate ? (
          <Uploader
            adapter={uploadAdapter}
            context="general"
            multiple={false}
            defaultFiles={file ? [file] : []}
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
