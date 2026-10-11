"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface ProjectsStatusChartProps {
  data: readonly { status: string; label: string; count: number }[];
  /** Series name in the tooltip (the count of projects). */
  countLabel: string;
  /** Accessible name of the chart; the figures are also read out as a list. */
  label: string;
}

/** Projects per status (registry `chart`, PRD §8.3 "Overview"): one bar per status, figures in a text list too. */
export function ProjectsStatusChart({ data, countLabel, label }: ProjectsStatusChartProps) {
  const config = { count: { label: countLabel, color: "var(--chart-1)" } } satisfies ChartConfig;

  return (
    <figure className="flex flex-col gap-3">
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <BarChart data={[...data]} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={6} />
        </BarChart>
      </ChartContainer>
      <figcaption className="sr-only">{label}</figcaption>
      <ul className="sr-only">
        {data.map((item) => (
          <li key={item.status}>
            {item.label}: {item.count}
          </li>
        ))}
      </ul>
    </figure>
  );
}
