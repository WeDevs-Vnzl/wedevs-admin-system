"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumnDef } from "@/components/ui/data-table";

type MiniRow = { id: string; cells: ReactNode[] };

/** A plain label, or a label with `align: "end"` for money columns (header and cells right-aligned). */
type MiniHeader = string | { label: string; align?: "end" };

type RelatedMiniTableProps = {
  title: string;
  description?: string;
  headers: MiniHeader[];
  rows: MiniRow[];
  // "+ Nuevo" action that pre-links the current record.
  newHref?: string;
  emptyTitle?: string;
};

// Mini-table used by related detail tabs and overviews (frontend-patterns §4).
export function RelatedMiniTable({
  title,
  description,
  headers,
  rows,
  newHref,
  emptyTitle,
}: RelatedMiniTableProps) {
  const t = useTranslations("patterns.relatedTable");

  return (
    <SectionCard
      heading
      title={title}
      description={description}
      actions={
        newHref ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={newHref}>
              <PlusIcon aria-hidden />
              {t("new")}
            </Link>
          </Button>
        ) : undefined
      }
    >
      <DataTable
        variant="compact"
        embedded
        data={rows}
        columns={headers.map((header, index): DataTableColumnDef<MiniRow> => {
          const { label, align } =
            typeof header === "string" ? { label: header, align: undefined } : header;
          return {
            id: `col-${index}`,
            header: label,
            cell: ({ row }) => row.original.cells[index],
            meta: { label, pinned: index === 0, align },
          };
        })}
        getRowId={(row) => row.id}
        emptyState={{ title: emptyTitle ?? t("empty") }}
      />
    </SectionCard>
  );
}
