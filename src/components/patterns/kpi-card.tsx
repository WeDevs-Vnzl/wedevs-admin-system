"use client";

import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type KpiCardProps = {
  label: string;
  value: ReactNode;
  // Variation vs the previous period, already formatted by the caller.
  variation?: { label: string; direction: "up" | "down" | "flat" };
  // 12-month sparkline or any small visual.
  sparkline?: ReactNode;
  // Detailed report the card opens (wireframe 4.2).
  href?: string;
};

const VARIATION_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

export function KpiCard({ label, value, variation, sparkline, href }: KpiCardProps) {
  const t = useTranslations("patterns.kpi");
  const Icon = variation ? VARIATION_ICON[variation.direction] : null;

  const body = (
    <>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
        {href ? <ArrowUpRight className="text-muted-foreground size-4" aria-hidden /> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {variation && Icon ? (
          <div
            className={cn(
              "flex items-center gap-1 text-xs",
              variation.direction === "down" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {variation.label}
          </div>
        ) : null}
        {sparkline ? <div className="h-10">{sparkline}</div> : null}
      </CardContent>
    </>
  );

  if (href) {
    return (
      <Card className="rounded-2xl transition-shadow hover:shadow-md">
        <Link href={href} aria-label={`${label} · ${t("open")}`} className="block focus-visible:outline-none">
          {body}
        </Link>
      </Card>
    );
  }
  return <Card className="rounded-2xl">{body}</Card>;
}
