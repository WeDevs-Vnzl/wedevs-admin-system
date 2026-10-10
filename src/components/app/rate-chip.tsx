"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
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
}

// The BCV chip of the topbar (PRD §9.2, wireframe 4.2). The rate is a decimal string; it is rounded for
// display only and formatted with Intl, never with Number() arithmetic (C15). Links to the rates catalog.
export function RateChip({ rate, missing }: RateChipProps) {
  const t = useTranslations("shell.rateChip");
  const locale = useLocale();

  const label = rate?.source === "BCV" || rate === null ? t("label") : t("labelOther");
  const amount = rate ? formatRate(rate.usdRate, locale) : null;
  const isFallback = rate !== null && missing;
  const tooltip = !rate
    ? t("missing")
    : isFallback
      ? t("fallback", { date: formatDate(rate.date, locale) })
      : t("asOf", { date: formatDate(rate.date, locale) });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href="/settings/rates" aria-label={t("link")} className="hidden md:inline-flex">
          <Badge
            variant="outline"
            className={
              missing
                ? "h-8 gap-1.5 rounded-full px-3 font-mono text-xs text-amber-700 dark:text-amber-400"
                : "h-8 gap-1.5 rounded-full px-3 font-mono text-xs"
            }
          >
            <Clock aria-hidden className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">{label}</span>
            {amount ? <span>{t("value", { rate: amount })}</span> : <span>{t("missing")}</span>}
          </Badge>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function formatRate(usdRate: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(usdRate) as `${number}`);
}
