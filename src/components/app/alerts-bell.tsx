"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AlertList } from "@/features/alerts/components/alert-list";

export interface AlertsBellProps {
  /** Bell counter from `getShellData` (active alerts of the current user). */
  count: number;
}

// R16: the counter badge sits on `bg-destructive`. White text is 5.44:1 on the light destructive (#c2362f)
// but only 3.04:1 on the dark one (#ef6a62), so the dark theme uses the dark `background` token instead
// (#0b0b0f on #ef6a62 = 6.46:1). The badge is 12px semibold; both pairs clear 4.5:1.
export const ALERTS_BADGE_CLASSES =
  "absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white dark:text-background";

// Bell with a counter and a popover panel (frontend-patterns §8). The panel mounts when it opens and loads
// the list through `listAlertsAction` (PD-5), so the panel and the counter agree; dismissing or snoozing
// updates the badge at once and the layout refresh brings the server count. "Mark all as read" stays as it
// was (H1-B5).
export function AlertsBell({ count }: AlertsBellProps) {
  const t = useTranslations("shell.alerts");
  // The live total only applies to the server count it was measured against.
  const [live, setLive] = useState<{ base: number; total: number } | null>(null);
  const shown = live && live.base === count ? live.total : count;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          aria-label={shown > 0 ? `${t("label")}: ${t("counter", { count: shown })}` : t("label")}
        >
          <Bell aria-hidden />
          {shown > 0 ? (
            <span aria-hidden data-slot="alerts-badge" className={ALERTS_BADGE_CLASSES}>
              {shown}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <PopoverHeader className="border-b p-4">
          <PopoverTitle>{t("title")}</PopoverTitle>
          <PopoverDescription>{t("description")}</PopoverDescription>
        </PopoverHeader>
        <div className="max-h-96 overflow-y-auto p-4">
          <AlertList
            variant="compact"
            limit={20}
            onTotalChange={(total) => setLive({ base: count, total })}
          />
        </div>
        <div className="flex justify-end border-t p-3">
          <Button variant="ghost" size="sm" disabled={shown === 0}>
            {t("markAllRead")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
