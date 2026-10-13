"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAGE_SIZE_VALUES, type PageSize } from "@/lib/validators/common";
import { guardPageSize } from "./use-table-url-state";

interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
  /** Redirects an out-of-range `page` to the last page. Off while rows load, when `total` is not final. */
  clamp?: boolean;
}

/** Server pagination: `total` comes from the query result, never from the visible rows. */
export function DataTablePagination({
  page: requestedPage,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  clamp = true,
}: DataTablePaginationProps) {
  const t = useTranslations("table");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = clamp ? Math.min(requestedPage, pageCount) : requestedPage;

  // A hand-edited `?page=` beyond the last page goes to the last page instead of showing an empty range.
  useEffect(() => {
    if (clamp && requestedPage > pageCount) onPageChange(pageCount);
  }, [clamp, requestedPage, pageCount, onPageChange]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <span className="text-muted-foreground" aria-live="polite">
        {t("pagination.range", { from, to, total })}
      </span>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(guardPageSize(value))}>
          <SelectTrigger size="sm" aria-label={t("pagination.pageSize")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_VALUES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t("pagination.perPage", { size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="tabular-nums">{t("pagination.page", { page, pageCount })}</span>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("pagination.previous")}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("pagination.next")}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
