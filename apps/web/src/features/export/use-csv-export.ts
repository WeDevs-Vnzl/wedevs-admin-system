"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import type { ActionResult, ListQuery } from "@/lib/validators/common";
import {
  EXPORT_MAX_ROWS,
  type ExportCsvResultDTO,
  type ExportEntity,
} from "@/lib/validators/export";

/** Starts the browser download of `content` as `filename`. */
function download(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on a later tick: Firefox can cancel the download if the URL is gone before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The data-table kit's `onExport(query, visibleColumns)`: calls the module's export action, downloads the
 * CSV and toasts the outcome (success, "cut at 10,000 rows", or `common.errors.<code>`).
 */
export function useCsvExport<E extends ExportEntity>(
  action: (input: {
    entity: E;
    query: ListQuery;
    columns: string[];
  }) => Promise<ActionResult<ExportCsvResultDTO>>,
  entity: E,
) {
  const t = useTranslations("table.export");
  const tErrors = useTranslations("common.errors");

  return useCallback(
    async (query: ListQuery, visibleColumns: string[]) => {
      const result = await action({ entity, query, columns: visibleColumns });
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      download(result.data.filename, result.data.content);
      if (result.data.truncated) toast.warning(t("truncated", { max: EXPORT_MAX_ROWS }));
      else toast.success(t("success", { count: result.data.rowCount }));
    },
    [action, entity, t, tErrors],
  );
}
