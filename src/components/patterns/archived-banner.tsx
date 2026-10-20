"use client";

import { Archive } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type ArchivedBannerProps = {
  // Owner/Admin only: the caller omits the handler for other roles.
  onRestore?: () => void;
  pending?: boolean;
};

export function ArchivedBanner({ onRestore, pending = false }: ArchivedBannerProps) {
  const t = useTranslations("patterns.archived");

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/60 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">{t("title")}</p>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
      </div>
      {onRestore ? (
        <Button variant="outline" size="sm" onClick={onRestore} disabled={pending}>
          {t("restore")}
        </Button>
      ) : null}
    </div>
  );
}
