"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { ActionError } from "@/lib/validators/common";

/**
 * Text for a failed action: the BE's message key when the catalogs know it (`invoices.errors.hasAllocations`,
 * `trash.errors.clientArchived`…), otherwise the generic `common.errors.<code>` (the BE never sends prose, C1).
 */
export function useActionErrorMessage(): (error: ActionError) => string {
  const t = useTranslations();
  // Stable between renders: the table lists with it in a `useCallback` dependency list.
  return useCallback(
    (error) =>
      error.message && t.has(error.message as never)
        ? t(error.message as never)
        : t(`common.errors.${error.code}` as never),
    [t],
  );
}
