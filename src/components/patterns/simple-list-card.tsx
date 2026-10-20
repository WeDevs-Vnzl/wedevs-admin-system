import Link from "next/link";
import type { ReactNode } from "react";
import { SectionCard } from "@/components/patterns/section-card";

type SimpleListValue = {
  node: ReactNode;
  // Muted prefix naming the value; set it when a row carries more than one value.
  label?: string;
};

type SimpleListRow = {
  id: string;
  label: ReactNode;
  values?: SimpleListValue[];
};

type SimpleListCardProps = {
  title: string;
  description?: string;
  emptyTitle: string;
  rows: SimpleListRow[];
};

/** A record's code (mono, muted) followed by its name, linked to the detail. */
export function ListCode({ href, code, name }: { href: string; code: string; name: ReactNode }) {
  return (
    <Link href={href} className="hover:underline">
      <span className="font-mono text-xs text-muted-foreground">{code}</span> {name}
    </Link>
  );
}

// Overview widget for short lists of three simple columns or fewer: a label on the left and its values
// right-aligned, without table chrome. Wider data or badge columns use `RelatedMiniTable`.
export function SimpleListCard({ title, description, emptyTitle, rows }: SimpleListCardProps) {
  return (
    <SectionCard title={title} description={description}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyTitle}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0">{row.label}</span>
              {row.values?.length ? (
                <span className="flex shrink-0 items-center gap-4 text-end tabular-nums">
                  {row.values.map((value, index) => (
                    <span key={index}>
                      {value.label ? (
                        <span className="me-1.5 text-xs text-muted-foreground">{value.label}</span>
                      ) : null}
                      {value.node}
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
