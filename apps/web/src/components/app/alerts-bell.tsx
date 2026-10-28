"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { markAlertsReadAction } from "@/features/alerts/actions";
import { AlertList } from "@/features/alerts/components/alert-list";
import type { AlertsInboxDTO } from "@/lib/validators/alerts";

export interface AlertsBellProps {
  /** Bell counter from `countUnreadAlerts` (active alerts of the current user not marked read, A2). */
  count: number;
}

/** What the panel last loaded: the unread counter and the listed alerts still unread. */
interface LiveInbox {
  /** Server count it was measured against. */
  base: number;
  unread: number;
  unreadKeys: string[];
}

const liveInbox = (base: number, inbox: AlertsInboxDTO): LiveInbox => {
  const read = new Set(inbox.readKeys);
  return {
    base,
    unread: inbox.unread,
    unreadKeys: inbox.items.map((alert) => alert.alertKey).filter((key) => !read.has(key)),
  };
};

// R16: the counter badge sits on `bg-destructive`. White text is 5.44:1 on the light destructive (#c2362f)
// but only 3.04:1 on the dark one (#ef6a62), so the dark theme uses the dark `background` token instead
// (#0b0b0f on #ef6a62 = 6.46:1). The badge is 12px semibold; both pairs clear 4.5:1.
export const ALERTS_BADGE_CLASSES =
  "absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white dark:text-background";

// Bell with an unread counter and a popover panel (PRD §7.9, frontend-patterns §8). The panel mounts when it
// opens and loads the list through `listAlertsAction` (PD-5), so the panel and the counter agree; dismissing
// or snoozing updates the badge at once and the layout refresh brings the server count. "Mark all as read"
// marks the listed unread alerts for this user (A2): they stay in the panel and leave the counter.
export function AlertsBell({ count }: AlertsBellProps) {
  const t = useTranslations("shell.alerts");
  const tCommon = useTranslations("common");
  const titleId = useId();
  // The live inbox only applies to the server count it was measured against.
  const [live, setLive] = useState<LiveInbox | null>(null);
  const [marking, setMarking] = useState(false);
  const current = live && live.base === count ? live : null;
  const shown = current ? current.unread : count;

  const markRead = async () => {
    if (!current || current.unreadKeys.length === 0) return;
    setMarking(true);
    const result = await markAlertsReadAction({ alertKeys: current.unreadKeys });
    setMarking(false);
    if (!result.ok) {
      toast.error(tCommon(`errors.${result.error.code}`));
      return;
    }
    const marked = result.data.alertKeys.length;
    setLive({ base: count, unread: Math.max(0, current.unread - marked), unreadKeys: [] });
    toast.success(t("markedRead"));
  };

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
      <PopoverContent
        align="end"
        aria-labelledby={titleId}
        className="w-96 max-w-[calc(100vw-2rem)] p-0"
      >
        <PopoverHeader className="border-b p-4">
          <PopoverTitle id={titleId}>{t("title")}</PopoverTitle>
          <PopoverDescription>{t("description")}</PopoverDescription>
        </PopoverHeader>
        <div className="max-h-96 overflow-y-auto p-4">
          <AlertList
            variant="compact"
            limit={20}
            onLoad={(inbox) => setLive(liveInbox(count, inbox))}
          />
        </div>
        <div className="flex justify-end border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={marking || !current || current.unreadKeys.length === 0}
            onClick={() => void markRead()}
          >
            {t("markAllRead")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
