"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { DateText } from "@/components/patterns/date-text";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import { entityHref } from "@/lib/entity-routes";
import type { DocumentLinkTarget, DocumentListRowDTO } from "@/lib/validators/documents";
import { DocumentRowActions } from "./document-row-actions";

interface CategoryChip {
  id: string;
  name: string;
  nameEn: string | null;
}

interface EntityDocumentsTableProps {
  /** Every document linked to the record (not one page): the chips count and filter over all of them. */
  rows: DocumentListRowDTO[];
  /** The whole category catalog, in catalog order; a category with no document shows 0. */
  categories: CategoryChip[];
  target: DocumentLinkTarget;
  canUpdate: boolean;
}

const helper = createDataTableColumnHelper<DocumentListRowDTO>();

/**
 * The documents linked to a client or project (wireframe 4.6): category chips with counts that filter the rows
 * ("All" clears the filter), then the shared compact table.
 */
export function EntityDocumentsTable({
  rows,
  categories,
  target,
  canUpdate,
}: EntityDocumentsTableProps) {
  const t = useTranslations("documents.tab");
  const locale = useLocale();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const counts = countByCategory(rows);
  const visible = categoryId ? rows.filter((row) => row.category.id === categoryId) : rows;
  const chips = [
    { id: null, label: t("all"), count: rows.length },
    ...categories.map((category) => ({
      id: category.id,
      label: localName(category, locale),
      count: counts.get(category.id) ?? 0,
    })),
  ];

  const columns: DataTableColumnDef<DocumentListRowDTO>[] = [
    helper.accessor("code", {
      header: t("columns.code"),
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span>,
      meta: { label: t("columns.code"), pinned: true },
      size: 120,
    }),
    helper.accessor("title", {
      header: t("columns.title"),
      cell: ({ row }) => {
        const href = entityHref({ type: "DOCUMENT", id: row.original.id });
        return (
          <span className="font-medium">
            {href ? <Link href={href}>{row.original.title}</Link> : row.original.title}
          </span>
        );
      },
      meta: { label: t("columns.title") },
      size: 240,
    }),
    helper.display({
      id: "type",
      header: t("columns.type"),
      cell: ({ row }) => localName(row.original.type, locale),
      meta: { label: t("columns.type") },
    }),
    helper.accessor("status", {
      header: t("columns.status"),
      cell: ({ getValue }) => <StatusBadge enumName="DocumentStatus" value={getValue()} />,
      meta: { label: t("columns.status") },
    }),
    helper.accessor("currentVersionNumber", {
      header: t("columns.version"),
      cell: ({ getValue }) => {
        const number = getValue();
        return number === null ? t("noVersion") : t("versionLabel", { number });
      },
      meta: { label: t("columns.version") },
      size: 120,
    }),
    helper.accessor("updatedAt", {
      header: t("columns.updated"),
      cell: ({ getValue }) => <DateText value={new Date(getValue())} style="short" />,
      meta: { label: t("columns.updated") },
      size: 130,
    }),
    ...(canUpdate
      ? [
          helper.display({
            id: "actions",
            header: () => <span className="sr-only">{t("columns.actions")}</span>,
            cell: ({ row }) => (
              <DocumentRowActions
                documentId={row.original.id}
                documentTitle={row.original.title}
                target={target}
              />
            ),
            meta: {
              label: t("columns.actions"),
              hideable: false,
              exportable: false,
              align: "end" as const,
            },
            size: 80,
          }),
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={t("filterLabel")} className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const pressed = chip.id === categoryId;
          return (
            <li key={chip.id ?? "all"}>
              <Button
                type="button"
                size="sm"
                variant={pressed ? "secondary" : "outline"}
                className="h-7 rounded-full px-3 text-xs"
                aria-pressed={pressed}
                data-category-id={chip.id ?? undefined}
                onClick={() => setCategoryId(chip.id)}
              >
                {chip.label} · {chip.count}
              </Button>
            </li>
          );
        })}
      </ul>
      <DataTable
        variant="compact"
        embedded
        data={visible}
        columns={columns}
        getRowId={(row) => row.id}
        emptyState={{ title: categoryId ? t("emptyCategory") : t("empty") }}
      />
    </div>
  );
}

function countByCategory(rows: readonly DocumentListRowDTO[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.category.id, (counts.get(row.category.id) ?? 0) + 1);
  return counts;
}

/** Catalog label in the current locale: the English name in English when the catalog has one (PRD §7.8). */
function localName(item: { name: string; nameEn: string | null }, locale: string): string {
  return locale === "en" && item.nameEn ? item.nameEn : item.name;
}
