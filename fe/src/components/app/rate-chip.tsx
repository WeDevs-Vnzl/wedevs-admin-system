"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShellVesRate } from "@/features/shell/queries";
import { formatDate } from "@/lib/dates";
import { roundMoney } from "@/lib/money";

export interface RateChipProps {
  /** The VES rate of the shell (`getShellData`); `null` when none exists at all. */
  rate: ShellVesRate | null;
  /** True when a business day has no rate yet, or the one shown is an earlier fallback. */
  missing: boolean;
  /** Whether the user may manage rates (`can(user, "read", "settings")`, computed by the shell layout, m2). */
  canManage: boolean;
}

// The BCV chip of the topbar (PRD §9.2, wireframe 4.2). The rate is a decimal string; it is rounded for
// display only and formatted with Intl, never with Number() arithmetic (C15). Links to the rates catalog
// for roles that manage rates; other roles get the same chip, focusable so the tooltip still opens (m2, R6).
// The accessible name is the visible text (WCAG 2.5.3); the link purpose is the description.
export function RateChip({ rate, missing, canManage }: RateChipProps) {
  const t = useTranslations("shell.rateChip");
  const locale = useLocale();
  const descriptionId = useId();

  const label = rate?.source === "BCV" || rate === null ? t("label") : t("labelOther");
  const amount = rate ? formatRate(rate.usdRate, locale) : null;
  const isFallback = rate !== null && missing;
  const tooltip = !rate
    ? t("missing")
    : isFallback
      ? t("fallback", { date: formatDate(rate.date, locale) })
      : t("asOf", { date: formatDate(rate.date, locale) });

  const badge = (
    <Badge
      variant="outline"
      className={
        missing
          ? "h-8 gap-1.5 rounded-full px-3 font-mono text-xs text-amber-700 dark:text-amber-400"
          : "h-8 gap-1.5 rounded-full px-3 font-mono text-xs"
      }
    >
      <Clock aria-hidden className="size-4 text-muted-foreground max-lg:hidden" />
      <span className="text-muted-foreground max-lg:sr-only">{label}</span>
      {amount ? <span>{t("value", { rate: amount })}</span> : <span>{t("missing")}</span>}
    </Badge>
  );

  return (
    <div className="hidden md:inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          {canManage ? (
            <Link href="/settings/rates" aria-describedby={descriptionId} className="inline-flex">
              {badge}
            </Link>
          ) : (
            <span
              tabIndex={0}
              className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {badge}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {canManage ? (
        <span id={descriptionId} className="sr-only">
          {t("link")}
        </span>
      ) : null}
    </div>
  );
}

export function formatRate(usdRate: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(usdRate) as `${number}`);
}
