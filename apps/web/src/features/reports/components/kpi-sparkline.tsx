"use client";

import { Line, LineChart } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { SeriesPoint } from "@/lib/validators/dashboard";

const config = { value: { color: "var(--chart-1)" } } satisfies ChartConfig;

export interface KpiSparklineProps {
  points: readonly SeriesPoint[];
  /** Accessible name of the figure list ("Últimos 12 meses"). */
  label: string;
  /** Formats one value for the list read out to assistive tech. */
  formatValue: (value: string) => string;
}

/** 12-month sparkline of a KPI card (PRD §8.13.2); the points are also read out as a list. */
export function KpiSparkline({ points, label, formatValue }: KpiSparklineProps) {
  const data = points.map((point) => ({ period: point.period, value: Number(point.value) }));
  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-10 w-full" aria-hidden>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Line dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
      <ul aria-label={label} className="sr-only">
        {points.map((point) => (
          <li key={point.period}>
            {point.period}: {formatValue(point.value)}
          </li>
        ))}
      </ul>
    </>
  );
}
