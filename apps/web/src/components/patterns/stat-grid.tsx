import type { ReactNode } from "react";

export type StatGridItem = {
  label: string;
  value: ReactNode;
  hint?: string;
};

// Figures inside a card: a borderless grid of label and value, so a card never holds other cards.
export function StatGrid({ items }: { items: StatGridItem[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 space-y-1">
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{item.value}</dd>
          {item.hint ? <dd className="text-xs text-muted-foreground">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
