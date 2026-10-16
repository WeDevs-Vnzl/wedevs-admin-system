"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";

/** QR code of the public URL (PRD §8.11 "generar un código QR"), drawn as SVG in the browser, with a download. */
export function ShareQrCode({ url }: { url: string }) {
  const t = useTranslations("shares.detail.link");
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((svg) => {
      if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="size-40 rounded-lg bg-white p-2 shadow-[0_0_0_1px_oklch(0_0_0/0.1)]">
        {src ? (
          // A data URI: next/image would add nothing.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={t("qrAlt")} className="size-full" />
        ) : null}
      </div>
      {src ? (
        <Button variant="outline" size="sm" asChild>
          <a href={src} download="portal-link-qr.svg">
            <Download aria-hidden />
            {t("downloadQr")}
          </a>
        </Button>
      ) : null}
    </div>
  );
}
