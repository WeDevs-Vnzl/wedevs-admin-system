"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface DataTableBulkBarProps {
  count: number;
  onClear: () => void;
  /** Bulk actions slot, rendered with the selected ids by the table. */
  children?: ReactNode;
}

/** Shown above the table while rows are selected. Actions are provided by the caller. */
export function DataTableBulkBar({ count, onClear, children }: DataTableBulkBarProps) {
  const t = useTranslations("table");
  return (
    <div
      role="region"
      aria-label={t("bulk.region")}
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2"
    >
      <span className="text-sm font-medium">{t("bulk.selected", { count })}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        <X data-icon="inline-start" />
        {t("bulk.clear")}
      </Button>
    </div>
  );
}
