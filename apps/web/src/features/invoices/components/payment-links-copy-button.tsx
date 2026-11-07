"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const COPIED_MS = 2000;

/** Copies the checkout URL; the URL itself is never shown in a toast or logged. The icon cross-fades to a check. */
export function PaymentLinkCopyButton({ url }: { url: string }) {
  const t = useTranslations("invoices.paymentLinks");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("toast.copied"));
    } catch {
      // Clipboard access can be denied; the link stays available through "Open link".
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? t("copied") : t("copy")}
      onClick={() => void onCopy()}
    >
      <span className="relative inline-flex size-4 items-center justify-center" aria-hidden>
        <Copy
          className={`absolute transition-[opacity,transform] duration-150 ${copied ? "scale-75 opacity-0" : "scale-100 opacity-100"}`}
        />
        <Check
          className={`absolute transition-[opacity,transform] duration-150 ${copied ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
        />
      </span>
    </Button>
  );
}
