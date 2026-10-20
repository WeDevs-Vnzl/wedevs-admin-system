"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/validators/common";
import type { ReportFilter } from "@/lib/validators/reports";
import { filterToQuery } from "../report-catalog";

/**
 * Range state of a report screen (HU-31 CA2): a new range reloads the data through `load` and replaces it as a
 * whole, so every card and chart follows; only the latest request lands. The range is mirrored in the URL
 * (`?preset=…`) without a navigation, so a reload or a shared link opens the same range.
 */
export function useReportRange<T>(
  initialFilter: ReportFilter,
  initialData: T,
  load: (filter: ReportFilter) => Promise<ActionResult<T>>,
) {
  const t = useTranslations("reports.errors");
  const [filter, setFilter] = useState(initialFilter);
  const [data, setData] = useState(initialData);
  const [pending, setPending] = useState(false);
  const request = useRef(0);

  const changeFilter = useCallback(
    (next: ReportFilter) => {
      setFilter(next);
      window.history.replaceState(null, "", `${window.location.pathname}${filterToQuery(next)}`);
      const id = (request.current += 1);
      setPending(true);
      void load(next).then((result) => {
        if (id !== request.current) return;
        setPending(false);
        if (result.ok) setData(result.data);
        else toast.error(t("load"));
      });
    },
    [load, t],
  );

  return { filter, data, pending, changeFilter };
}
