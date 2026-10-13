import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

type PageHeaderProps = {
  title: string;
  description?: string;
  // Count shown next to the title (e.g. number of clients).
  count?: number;
  // Primary and secondary actions, right-aligned on wide screens.
  actions?: ReactNode;
};

export function PageHeader({ title, description, count, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {count === undefined ? null : (
            <Badge variant="secondary" className="tabular-nums">
              {count}
            </Badge>
          )}
        </div>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
