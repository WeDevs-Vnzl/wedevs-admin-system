"use client";

import { PrinterIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * "Imprimir / Guardar como PDF" (PRD §8.9.5): opens the browser print dialog, where "Save as PDF" is a
 * destination. It never prints itself (`data-print-hide`); the printed content is the `PrintRegion`.
 */
export function PrintButton({ className }: { className?: string }) {
  const t = useTranslations("documents.print");
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      data-print-hide=""
      onClick={() => window.print()}
    >
      <PrinterIcon aria-hidden />
      {t("action")}
    </Button>
  );
}
