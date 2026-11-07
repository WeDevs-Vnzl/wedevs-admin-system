"use client";

import { Download, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { fileDownloadPath } from "@/lib/api/file-url";
import type { PaymentReceiptDto } from "@/lib/api/types/payments";

type PaymentReceiptProps = {
  receipt: PaymentReceiptDto | null;
};

/**
 * Receipt of a payment (HU-14 CA2), viewed in place and never downloaded to look at it. The one file-view
 * convention (rule 25, DT-206): the stored file comes through `fileDownloadPath` — a PDF in the kit viewer, an image
 * in an `<img>`, anything else as a download card.
 */
export function PaymentReceipt({ receipt }: PaymentReceiptProps) {
  const t = useTranslations("payments.detail");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("receiptTitle")}</CardTitle>
        <CardDescription>{t("receiptDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {receipt ? (
          <div className="flex flex-col gap-4">
            <ReceiptView receipt={receipt} />
            <dl className="grid gap-2 text-sm @md:grid-cols-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t("receiptFile")}</dt>
                <dd className="break-all">{receipt.originalName}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t("receiptMime")}</dt>
                <dd>{receipt.mimeType}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t("receiptSize")}</dt>
                <dd className="tabular-nums">
                  {t("receiptSizeValue", { kb: Math.max(1, Math.round(receipt.sizeBytes / 1024)) })}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("receiptEmpty")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReceiptView({ receipt }: { receipt: PaymentReceiptDto }) {
  const t = useTranslations("payments.detail");
  const href = fileDownloadPath(receipt.id);

  if (receipt.mimeType === "application/pdf") {
    return (
      <PdfViewer url={href} onDownload={() => window.location.assign(href)} className="h-[560px]" />
    );
  }
  if (receipt.mimeType.startsWith("image/")) {
    return (
      // The authenticated route answers a signed redirect; `next/image` would add nothing.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={href}
        alt={t("receiptImageAlt", { name: receipt.originalName })}
        className="max-h-[560px] w-full rounded-xl border object-contain"
      />
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
      <span className="flex min-w-0 items-center gap-3 text-sm">
        <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{receipt.originalName}</span>
      </span>
      <Button variant="outline" asChild>
        <a href={href}>
          <Download aria-hidden />
          {t("receiptDownload")}
        </a>
      </Button>
    </div>
  );
}
