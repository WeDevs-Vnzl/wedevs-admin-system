import { useId, type ReactNode } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DashboardPanelProps = {
  title: string;
  /** Header extras on the right (a chip, an action). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** A titled dashboard card exposed as a region named by its title, so each panel is a landmark. */
export function DashboardPanel({ title, actions, className, children }: DashboardPanelProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn("min-w-0", className)}>
      <Card className="h-full rounded-2xl">
        <CardHeader>
          <CardTitle id={titleId} role="heading" aria-level={2} className="text-base">
            {title}
          </CardTitle>
          {actions ? <CardAction className="flex items-center gap-2">{actions}</CardAction> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

type PanelRow = { id: string; primary: ReactNode; secondary?: ReactNode; value?: ReactNode };

/** Rows of a panel: a primary line, a muted secondary line and a right-aligned value. */
export function PanelList({ rows, emptyTitle }: { rows: PanelRow[]; emptyTitle: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyTitle}</p>;
  return (
    <ul className="divide-y text-sm">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <div className="min-w-0 space-y-0.5">
            <div className="truncate font-medium">{row.primary}</div>
            {row.secondary ? (
              <div className="truncate text-xs text-muted-foreground">{row.secondary}</div>
            ) : null}
          </div>
          {row.value ? <div className="shrink-0 text-end tabular-nums">{row.value}</div> : null}
        </li>
      ))}
    </ul>
  );
}
