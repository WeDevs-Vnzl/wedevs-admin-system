import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

type StatCardProps = {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  hint?: string;
};

// Compact figure without navigation, used in the activity stats row (wireframe 4.7).
export function StatCard({ label, value, icon: Icon, hint }: StatCardProps) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
          {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
        </div>
        {Icon ? <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden /> : null}
      </CardContent>
    </Card>
  );
}
