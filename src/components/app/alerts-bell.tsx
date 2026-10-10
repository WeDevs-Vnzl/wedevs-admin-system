"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmptyState } from "@/components/patterns/empty-state";

export interface AlertsBellProps {
  /** Bell counter from `getShellData`. `0` until the alerts query lands in H1-B2. */
  count: number;
}

// Bell with a counter and a popover panel (frontend-patterns §8). The panel shows the empty state until the
// alerts query exists (H1-B2); "Mark all as read" stays disabled while there is nothing to mark.
export function AlertsBell({ count }: AlertsBellProps) {
  const t = useTranslations("shell.alerts");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          aria-label={count > 0 ? `${t("label")}: ${t("counter", { count })}` : t("label")}
        >
          <Bell aria-hidden />
          {count > 0 ? (
            <span
              aria-hidden
              className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
            >
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PopoverHeader className="border-b p-4">
          <PopoverTitle>{t("title")}</PopoverTitle>
          <PopoverDescription>{t("description")}</PopoverDescription>
        </PopoverHeader>
        <div className="p-4">
          <EmptyState icon={Bell} title={t("empty")} />
        </div>
        <div className="flex justify-end border-t p-3">
          <Button variant="ghost" size="sm" disabled={count === 0}>
            {t("markAllRead")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
