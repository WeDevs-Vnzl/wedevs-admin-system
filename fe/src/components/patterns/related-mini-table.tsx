"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {newHref ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={newHref}>{t("new")}</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <DataTable
          variant="compact"
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
      </CardContent>
    </Card>
  );
}
