"use client";

import { useTranslations } from "next-intl";
import type { ActionError } from "@/lib/validators/common";

/**
 * The text of a failed payment command: the BE's first field error (it names what exceeded which limit), else its
 * message key, else the generic text of the code. The BE answers i18n keys, never prose (C1).
 */
export function useErrorText() {
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  return (error: ActionError): string => {
    const specific = Object.values(error.fieldErrors ?? {}).flat()[0];
    const key = specific ?? error.message;
    return key ? tRoot(key as never) : tErrors(error.code);
  };
}
