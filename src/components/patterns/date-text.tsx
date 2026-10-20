"use client";

import { useLocale } from "next-intl";
import { BUSINESS_TIME_ZONE, formatDate, type DateOnly, type DateStyle } from "@/lib/dates";
import { cn } from "@/lib/utils";

type DateTextProps = {
  value: Date | DateOnly;
  style?: DateStyle;
  // Display zone from the user preference; defaults to the business zone (DT-43).
  timeZone?: string;
  className?: string;
};

// Date through formatDate with the current locale. Date-only strings are calendar days and are never
// shifted by the zone (see lib/dates).
export function DateText({
  value,
  style = "medium",
  timeZone = BUSINESS_TIME_ZONE,
  className,
}: DateTextProps) {
  const locale = useLocale();
  const dateTime = typeof value === "string" ? value : value.toISOString();

  return (
    <time dateTime={dateTime} className={cn("whitespace-nowrap", className)}>
      {formatDate(value, locale, style, timeZone)}
    </time>
  );
}
