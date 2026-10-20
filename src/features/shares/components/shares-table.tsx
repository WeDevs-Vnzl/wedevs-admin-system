"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import { searchClientsAction } from "@/features/clients/actions";
import type { ListQuery } from "@/lib/validators/common";
import { SHARE_STATUS_VALUES, type ShareLinkListRowDTO } from "@/lib/validators/shares";
import { listShareLinksAction } from "../actions";
import { ShareStatusBadge } from "./share-status-badge";
import { shareFilterOf } from "./shares-table-query";

interface SharesTableProps {
  /** First page, read on the server for the query in the URL. */
  initialRows: ShareLinkListRowDTO[];
  initialTotal: number;
}

const helper = createDataTableColumnHelper<ShareLinkListRowDTO>();

/**
 * `/documents/shares` (PRD §8.11 "La vista `/documents/shares` lista todos los enlaces"): title, client, documents
 * (with how many need a key), status, expiry, counters and last access, with facets, search, sort and pagination in
 * the URL. Later query changes reload through `listShareLinksAction`.
 */
export function SharesTable({ initialRows, initialTotal }: SharesTableProps) {
  const t = useTranslations("shares.table");
  const tErrors = useTranslations("common.errors");
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listShareLinksAction(shareFilterOf(next));
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

  const columns = useMemo<DataTableColumnDef<ShareLinkListRowDTO>[]>(
    () =>
      [
        helper.accessor("title", {
          header: t("columns.title"),
          size: 260,
          meta: { label: t("columns.title"), sortable: true, pinned: true },
          cell: ({ row }) => (
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={`/documents/shares/${row.original.id}`}
            >
              {row.original.title}
            </Link>
          ),
        }),
        helper.accessor((row) => row.client?.label ?? "", {
          id: "client",
          header: t("columns.client"),
          size: 180,
          meta: { label: t("columns.client"), sortable: false },
          cell: ({ row }) => row.original.client?.label ?? "—",
        }),
        helper.accessor("documentCount", {
          id: "documents",
          header: t("columns.documents"),
          size: 130,
          meta: { label: t("columns.documents"), sortable: false },
          cell: ({ row }) =>
            row.original.protectedDocumentCount > 0
              ? t("documentCountProtected", {
                  count: row.original.documentCount,
                  protected: row.original.protectedDocumentCount,
                })
              : t("documentCount", { count: row.original.documentCount }),
        }),
        helper.accessor("status", {
          header: t("columns.status"),
          size: 120,
          meta: { label: t("columns.status"), sortable: true },
          cell: ({ row }) => <ShareStatusBadge status={row.original.status} />,
        }),
        helper.accessor("expiresAt", {
          header: t("columns.expiresAt"),
          size: 130,
          meta: { label: t("columns.expiresAt"), sortable: true },
          cell: ({ row }) =>
            row.original.expiresAt ? <DateText value={row.original.expiresAt} /> : t("noExpiry"),
        }),
        helper.accessor((row) => row.counters.viewCount, {
          id: "viewCount",
          header: t("columns.views"),
          size: 100,
          meta: { label: t("columns.views"), sortable: true },
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.counters.viewCount}</span>
          ),
        }),
        helper.accessor((row) => row.counters.downloadCount, {
          id: "downloadCount",
          header: t("columns.downloads"),
          size: 110,
          meta: { label: t("columns.downloads"), sortable: true },
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.counters.downloadCount}</span>
          ),
        }),
        helper.accessor((row) => row.counters.failedUnlockCount, {
          id: "failedUnlockCount",
          header: t("columns.failedUnlocks"),
          size: 130,
          meta: { label: t("columns.failedUnlocks"), sortable: false },
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.counters.failedUnlockCount}</span>
          ),
        }),
        helper.accessor("lastAccessedAt", {
          header: t("columns.lastAccessedAt"),
          size: 140,
          meta: { label: t("columns.lastAccessedAt"), sortable: true },
          cell: ({ row }) =>
            row.original.lastAccessedAt ? (
              <DateText value={new Date(row.original.lastAccessedAt)} style="short" />
            ) : (
              t("never")
            ),
        }),
        helper.accessor("createdAt", {
          header: t("columns.createdAt"),
          size: 130,
          meta: { label: t("columns.createdAt"), sortable: true },
          cell: ({ row }) => <DateText value={new Date(row.original.createdAt)} style="short" />,
        }),
      ] as DataTableColumnDef<ShareLinkListRowDTO>[],
    [t],
  );

  const tStatus = useTranslations("shares.status");
  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "status",
        label: t("facets.status"),
        kind: "options",
        options: SHARE_STATUS_VALUES.map((value) => ({ value, label: tStatus(value) })),
      },
      {
        id: "clientId",
        label: t("facets.client"),
        kind: "async",
        loadOptions: async (search) => {
          const result = await searchClientsAction({ q: search });
          return result.ok ? result.data.map((ref) => ({ value: ref.id, label: ref.label })) : [];
        },
      },
      {
        id: "hasAccessKeys",
        label: t("facets.hasAccessKeys"),
        kind: "options",
        options: [
          { value: "true", label: t("withKeys") },
          { value: "false", label: t("withoutKeys") },
        ],
      },
      {
        id: "created",
        label: t("facets.created"),
        kind: "dateRange",
        fromKey: "createdFrom",
        toKey: "createdTo",
      },
    ],
    [t, tStatus],
  );

  return (
    <DataTable<ShareLinkListRowDTO>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      facets={facets}
      searchPlaceholder={t("search.placeholder")}
      emptyState={{ title: t("empty.title"), description: t("empty.description") }}
    />
  );
}
