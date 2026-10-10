import type { ReactNode } from "react";

type OverviewLayoutProps = {
  header: ReactNode;
  // KPI row (KpiCard / StatCard).
  kpis?: ReactNode;
  // Main column: recent items, charts.
  main: ReactNode;
  // Side column: module alerts, quick actions.
  aside?: ReactNode;
};

// Module overview skeleton (frontend-patterns §3): header, KPI row, then main + aside columns.
export function OverviewLayout({ header, kpis, main, aside }: OverviewLayoutProps) {
  return (
    <div className="flex flex-col gap-6">
      {header}
      {kpis ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{kpis}</div> : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">{main}</div>
        {aside ? <aside className="space-y-6">{aside}</aside> : null}
      </div>
    </div>
  );
}
