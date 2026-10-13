"use client";

import { ChartColumn, Table as TableIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type OverviewTableToggleProps = {
  current: "overview" | "table";
  overviewHref: string;
  tableHref: string;
};

// Segmented "Resumen | Tabla" control switching between /<module> and /<module>/list (wireframe 4.4).
export function OverviewTableToggle({
  current,
  overviewHref,
  tableHref,
}: OverviewTableToggleProps) {
  const t = useTranslations("patterns.overviewToggle");

  return (
    <ToggleGroup type="single" variant="outline" value={current} aria-label={t("label")}>
      <ToggleGroupItem value="overview" asChild>
        <Link href={overviewHref} aria-current={current === "overview" ? "page" : undefined}>
          <ChartColumn />
          {t("overview")}
        </Link>
      </ToggleGroupItem>
      <ToggleGroupItem value="table" asChild>
        <Link href={tableHref} aria-current={current === "table" ? "page" : undefined}>
          <TableIcon />
          {t("table")}
        </Link>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
