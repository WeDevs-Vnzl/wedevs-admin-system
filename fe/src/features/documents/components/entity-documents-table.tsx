"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { DateText } from "@/components/patterns/date-text";
import { StatusBadge } from "@/components/patterns/status-badge";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import { entityHref } from "@/lib/entity-routes";
import type { DocumentLinkTarget, DocumentListRowDTO } from "@/lib/validators/documents";
import { DocumentRowActions } from "./document-row-actions";

interface EntityDocumentsTableProps {
  rows: DocumentListRowDTO[];
  target: DocumentLinkTarget;
  canUpdate: boolean;
}

const helper = createDataTableColumnHelper<DocumentListRowDTO>();

/** The documents linked to a client or project, in the shared compact table (wireframe 4.6). */
export function EntityDocumentsTable({ rows, target, canUpdate }: EntityDocumentsTableProps) {
  const t = useTranslations("documents.tab");
  const locale = useLocale();

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
    <DataTable
      variant="compact"
      embedded
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      emptyState={{ title: t("empty") }}
    />
  );
}

/** Catalog label in the current locale: the English name in English when the catalog has one (PRD §7.8). */
function localName(item: { name: string; nameEn: string | null }, locale: string): string {
  return locale === "en" && item.nameEn ? item.nameEn : item.name;
}
