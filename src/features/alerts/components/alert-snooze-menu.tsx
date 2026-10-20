"use client";

import { BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Snooze lengths offered in the menu (the service accepts 1–90). */
export const ALERT_SNOOZE_OPTIONS = [1, 3, 7] as const;

export interface AlertSnoozeMenuProps {
  /** Alert title, for the accessible name of the trigger. */
  title: string;
  disabled?: boolean;
  onSnooze: (days: number) => void;
}

export function AlertSnoozeMenu({ title, disabled, onSnooze }: AlertSnoozeMenuProps) {
  const t = useTranslations("alerts.actions");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`${t("snooze")}: ${title}`}
        >
          <BellOff aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("snooze")}</DropdownMenuLabel>
        {ALERT_SNOOZE_OPTIONS.map((days) => (
          <DropdownMenuItem key={days} onSelect={() => onSnooze(days)}>
            {t("snoozeDays", { days })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
