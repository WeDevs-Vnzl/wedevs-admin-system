"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface DataTableExportButtonProps {
  onExport: () => void;
  disabled?: boolean;
}

/** Calls `onExport`; the table passes the query and visible columns (see `DataTableProps.onExport`). */
export function DataTableExportButton({ onExport, disabled }: DataTableExportButtonProps) {
  const t = useTranslations("table");
  return (
    <Button variant="outline" size="sm" onClick={onExport} disabled={disabled}>
      <Download data-icon="inline-start" />
      {t("export.label")}
    </Button>
  );
}
