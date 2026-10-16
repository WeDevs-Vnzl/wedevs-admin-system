"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  columnConfigToPreference,
  createDataTableColumnHelper,
  useTableUrlState,
  type ColumnConfig,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import { searchClientsAction } from "@/features/clients/actions";
import { setPreferenceAction } from "@/features/preferences/actions";
import { searchProjectsAction } from "@/features/projects/actions";
import { entityHref } from "@/lib/entity-routes";
import type { ListQuery } from "@/lib/validators/common";
import type { DocumentCategoryDetailDTO } from "@/lib/validators/document-types";
import type { DocumentListRowDTO } from "@/lib/validators/documents";
import { DOCUMENT_FORMAT_VALUES, DOCUMENT_STATUS_VALUES } from "@/lib/validators/enums";
import { tableColumnsKey } from "@/lib/validators/preferences";
import { listDocumentsAction } from "../actions";
import { DOCUMENT_COLUMN_IDS, documentFilterOf } from "./documents-table-query";

type DocumentsTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: DocumentListRowDTO[];
  initialTotal: number;
  /** Saved column layout (`table:documents:columns`). */
  initialColumns?: ColumnConfig[];
  /** Categories with their types, for the category and type facets. */
  categories: readonly DocumentCategoryDetailDTO[];
  permissions: { canCreate: boolean; canUpdate: boolean };
};

const helper = createDataTableColumnHelper<DocumentListRowDTO>();

/**
 * `/documents/list` (PRD §8.9.5 "Tabla"): code, title, category, type, status, current format, version, linked
 * records (chips), expiry, shared and last update, with facets, search, header sort and pagination kept in the
 * URL. The first render shows the server rows for the URL query; later query changes reload through
 * `listDocumentsAction` (the kit's URL state is shallow, so the server does not re-render).
 */
export function DocumentsTable({
  initialRows,
  initialTotal,
  initialColumns,
  categories,
  permissions,
}: DocumentsTableProps) {
  const t = useTranslations("documents");
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listDocumentsAction(documentFilterOf(next));
      setLoading(false);
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      setRows(result.data.items);
      setTotal(result.data.total);
    },
    [tErrors],
  );

  useEffect(() => {
    if (queryKey === firstQueryKey.current) return;
    void load(query);
  }, [query, queryKey, load]);

  const columns = useMemo<DataTableColumnDef<DocumentListRowDTO>[]>(
    () =>
      [
        helper.accessor("code", {
          header: t("table.columns.code"),
          size: 120,
          meta: { label: t("table.columns.code"), sortable: true, pinned: true },
          cell: ({ row }) => (
            <Link
              className="font-mono text-xs underline-offset-4 hover:underline"
              href={`/documents/${row.original.id}`}
            >
              {row.original.code}
            </Link>
          ),
        }),
        helper.accessor("title", {
          header: t("table.columns.title"),
          size: 260,
          meta: { label: t("table.columns.title"), sortable: true },
          cell: ({ row }) => (
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={`/documents/${row.original.id}`}
            >
              {row.original.title}
            </Link>
          ),
        }),
        helper.accessor((row) => catalogLabel(row.category, locale), {
          id: "category",
          header: t("table.columns.category"),
          size: 160,
          meta: { label: t("table.columns.category"), sortable: true },
        }),
        helper.accessor((row) => catalogLabel(row.type, locale), {
          id: "type",
          header: t("table.columns.type"),
          size: 180,
          meta: { label: t("table.columns.type"), sortable: true },
        }),
        helper.accessor("status", {
          header: t("table.columns.status"),
          size: 140,
          meta: { label: t("table.columns.status"), sortable: true },
          cell: ({ row }) => <StatusBadge enumName="DocumentStatus" value={row.original.status} />,
        }),
        helper.accessor((row) => row.currentFormat, {
          id: "format",
          header: t("table.columns.format"),
          size: 140,
          meta: { label: t("table.columns.format"), sortable: true },
          cell: ({ row }) =>
            row.original.currentFormat
              ? tEnums(`DocumentFormat.${row.original.currentFormat}`)
              : t("table.noVersion"),
        }),
        helper.accessor((row) => row.currentVersionNumber, {
          id: "versionNumber",
          header: t("table.columns.version"),
          size: 110,
          meta: { label: t("table.columns.version"), sortable: true },
          cell: ({ row }) =>
            row.original.currentVersionNumber === null
              ? t("table.noVersion")
              : t("table.versionLabel", { number: row.original.currentVersionNumber }),
        }),
        helper.display({
          id: "links",
          header: t("table.columns.links"),
          size: 220,
          meta: { label: t("table.columns.links"), sortable: false },
          cell: ({ row }) => (
            <span className="flex flex-wrap gap-1">
              {row.original.links.map((ref) => {
                const href = entityHref(ref);
                const chip = <EntityCodeChip code={ref.code ?? ref.label} />;
                return href ? (
                  <Link key={`${ref.type}:${ref.id}`} href={href} title={ref.label}>
                    {chip}
                  </Link>
                ) : (
                  <span key={`${ref.type}:${ref.id}`} title={ref.label}>
                    {chip}
                  </span>
                );
              })}
            </span>
          ),
        }),
        helper.accessor("expiresAt", {
          header: t("table.columns.expiresAt"),
          size: 130,
          meta: { label: t("table.columns.expiresAt"), sortable: true },
          cell: ({ row }) =>
            row.original.expiresAt ? <DateText value={row.original.expiresAt} /> : "—",
        }),
        helper.accessor("isShared", {
          id: "shared",
          header: t("table.columns.shared"),
          size: 110,
          meta: { label: t("table.columns.shared"), sortable: false },
          cell: ({ row }) => (row.original.isShared ? t("table.yes") : t("table.no")),
        }),
        helper.accessor("updatedAt", {
          header: t("table.columns.updatedAt"),
          size: 130,
          meta: { label: t("table.columns.updatedAt"), sortable: true },
          cell: ({ row }) => <DateText value={new Date(row.original.updatedAt)} style="short" />,
        }),
      ] as DataTableColumnDef<DocumentListRowDTO>[],
    [t, tEnums, locale],
  );

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "status",
        label: t("table.facets.status"),
        kind: "options",
        options: DOCUMENT_STATUS_VALUES.map((value) => ({
          value,
          label: tEnums(`DocumentStatus.${value}`),
        })),
      },
      {
        id: "categoryId",
        label: t("table.facets.category"),
        kind: "options",
        options: categories.map((category) => ({
          value: category.id,
          label: catalogLabel(category, locale),
        })),
      },
      {
        id: "typeId",
        label: t("table.facets.type"),
        kind: "options",
        options: categories.flatMap((category) =>
          category.types.map((type) => ({ value: type.id, label: catalogLabel(type, locale) })),
        ),
      },
      {
        id: "format",
        label: t("table.facets.format"),
        kind: "options",
        options: DOCUMENT_FORMAT_VALUES.map((value) => ({
          value,
          label: tEnums(`DocumentFormat.${value}`),
        })),
      },
      {
        id: "clientId",
        label: t("table.facets.client"),
        kind: "async",
        loadOptions: async (search) => {
          const result = await searchClientsAction({ q: search });
          return result.ok ? result.data.map((ref) => ({ value: ref.id, label: ref.label })) : [];
        },
      },
      {
        id: "projectId",
        label: t("table.facets.project"),
        kind: "async",
        loadOptions: async (search) => {
          const result = await searchProjectsAction({ q: search });
          return result.ok ? result.data.map((ref) => ({ value: ref.id, label: ref.label })) : [];
        },
      },
      {
        id: "shared",
        label: t("table.facets.shared"),
        kind: "options",
        options: [
          { value: "true", label: t("table.yes") },
          { value: "false", label: t("table.no") },
        ],
      },
      {
        id: "expires",
        label: t("table.facets.expires"),
        kind: "dateRange",
        fromKey: "expiresFrom",
        toKey: "expiresTo",
      },
    ],
    [t, tEnums, categories, locale],
  );

  return (
    <DataTable<DocumentListRowDTO>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      facets={facets}
      searchPlaceholder={t("table.search.placeholder")}
      showArchivedToggle={permissions.canUpdate}
      initialColumns={initialColumns}
      onColumnsChange={(config) => {
        const visible = config.filter((column) =>
          (DOCUMENT_COLUMN_IDS as readonly string[]).includes(column.id),
        );
        void setPreferenceAction({
          key: tableColumnsKey("documents"),
          value: columnConfigToPreference(visible),
        });
      }}
      emptyState={{
        title: t("table.empty.title"),
        description: t("table.empty.description"),
        action: permissions.canCreate ? (
          <Button asChild>
            <Link href="/documents/new">
              <Plus aria-hidden />
              {t("page.newAction")}
            </Link>
          </Button>
        ) : undefined,
      }}
    />
  );
}
