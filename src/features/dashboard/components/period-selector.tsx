"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DASHBOARD_PERIOD_VALUES, type DashboardPeriod } from "../period";

/** Mes / Trimestre / Año (frontend-patterns §9). The period lives in the URL, so the page reads it on the server. */
export function PeriodSelector({ period }: { period: DashboardPeriod }) {
  const t = useTranslations("dashboard.period");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const select = (value: string) => {
    const next = DASHBOARD_PERIOD_VALUES.find((item) => item === value);
    if (!next || next === period) return;
    startTransition(() => {
      router.replace(next === "month" ? "/dashboard" : `/dashboard?period=${next}`, {
        scroll: false,
      });
    });
  };

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      value={period}
      onValueChange={select}
      aria-label={t("label")}
      aria-busy={pending || undefined}
    >
      {DASHBOARD_PERIOD_VALUES.map((value) => (
        <ToggleGroupItem key={value} value={value} className="px-3">
          {t(value)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
