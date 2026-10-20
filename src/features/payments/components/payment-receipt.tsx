"use client";

import { FileText, ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FileDTO } from "@/lib/validators/files";

type PaymentReceiptProps = {
  receipt: FileDTO | null;
};

/**
 * Receipt of a payment (HU-14 CA2): shown in the detail, never downloaded to look at it. The preview needs the
 * stored binary, which only exists from Hito 2 (presigned URLs); until then the card shows the file's details.
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
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {receipt.mimeType.startsWith("image/") ? (
                <ImageIcon className="size-8" aria-hidden />
              ) : (
                <FileText className="size-8" aria-hidden />
              )}
              <p>{t("receiptPreviewUnavailable")}</p>
            </div>
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
                <dd>
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
