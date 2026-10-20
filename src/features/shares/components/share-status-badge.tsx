"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { ShareStatus } from "@/lib/validators/shares";

// `ShareStatus` is not one of the shared enums of `StatusBadge`; same tones: active = success, revoked = danger,
// expired = neutral.
const TONE_CLASS: Record<ShareStatus, string> = {
  ACTIVE:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  REVOKED:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  EXPIRED: "border-border bg-muted text-muted-foreground",
};

/** Status of a portal link: active, revoked or expired. */
export function ShareStatusBadge({ status }: { status: ShareStatus }) {
  const t = useTranslations("shares.status");
  return (
    <Badge variant="outline" className={TONE_CLASS[status]}>
      {t(status)}
    </Badge>
  );
}
