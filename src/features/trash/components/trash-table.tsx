"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestoreIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import type { ListQuery } from "@/lib/validators/common";
import { TRASHABLE_ENTITY_TYPE_VALUES, type TrashRowDTO } from "@/lib/validators/trash";
import { listTrashAction, restoreFromTrashAction } from "../actions";
import { trashFilterOf } from "./trash-table-query";

type TrashTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: TrashRowDTO[];
  initialTotal: number;
};

const helper = createDataTableColumnHelper<TrashRowDTO>();
const rowId = (row: TrashRowDTO) => `${row.entity.type}:${row.entity.id}`;

/**
 * Settings → Papelera (PRD §7.7): archived records with type and date filters, search, sort and pagination in
 * the URL. "Restaurar" returns a record to its previous state (HU-28 CA2); there is no permanent purge.
 */
export function TrashTable({ initialRows, initialTotal }: TrashTableProps) {
  const t = useTranslations("trash");
  const tTypes = useTranslations("enums.EntityType");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  // The first render already shows the server page for this URL; later query changes read through the action.
  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listTrashAction(trashFilterOf(next));
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

  const restore = useCallback(
    async (row: TrashRowDTO) => {
      const id = rowId(row);
      setRestoring(id);
      const result = await restoreFromTrashAction({
        entityType: row.entity.type,
        entityId: row.entity.id,
      });
      setRestoring(null);
      if (!result.ok) {
        // `message` is an i18n key: `trash.errors.*` for a collision, `common.errors.<CODE>` otherwise.
        toast.error(tRoot(result.error.message as never));
        return;
      }
      setRows((current) => current.filter((item) => rowId(item) !== id));
      setTotal((current) => Math.max(0, current - 1));
      toast.success(t("toast.restored", { label: row.entity.label }));
      // A client brings its contacts back too; reload so the page reflects every restored row.
      void load(query);
    },
    [t, tRoot, load, query],
  );

  const columns = useMemo<DataTableColumnDef<TrashRowDTO>[]>(
    () =>
      [
        helper.accessor((row) => row.entity.label, {
          id: "label",
          header: t("columns.label"),
          size: 260,
          meta: { label: t("columns.label"), sortable: true, pinned: true },
          cell: ({ row }) => (
            <div className="flex flex-col">
              <span className="font-medium">{row.original.entity.label}</span>
              {row.original.entity.code ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {row.original.entity.code}
                </span>
              ) : null}
            </div>
          ),
        }),
        helper.accessor((row) => row.entity.type, {
          id: "entityType",
          header: t("columns.entityType"),
          size: 150,
          meta: { label: t("columns.entityType"), sortable: true },
          cell: ({ row }) => tTypes(row.original.entity.type),
        }),
        helper.accessor("context", {
          header: t("columns.context"),
          size: 200,
          meta: { label: t("columns.context"), sortable: false },
          cell: ({ row }) => row.original.context ?? "—",
        }),
        helper.accessor("deletedAt", {
          header: t("columns.deletedAt"),
          size: 150,
          meta: { label: t("columns.deletedAt"), sortable: true },
          cell: ({ row }) => <DateText value={new Date(row.original.deletedAt)} style="short" />,
        }),
        helper.accessor((row) => row.deletedBy?.name ?? "", {
          id: "deletedBy",
          header: t("columns.deletedBy"),
          size: 170,
          meta: { label: t("columns.deletedBy"), sortable: false },
          cell: ({ row }) => row.original.deletedBy?.name ?? "—",
        }),
        helper.display({
          id: "actions",
          size: 130,
          meta: { label: t("columns.actions"), hideable: false, exportable: false },
          cell: ({ row }) => (
            <Button
              variant="outline"
              size="sm"
              aria-label={t("actions.restoreLabel", { label: row.original.entity.label })}
              disabled={restoring === rowId(row.original)}
              onClick={() => void restore(row.original)}
            >
              <ArchiveRestoreIcon aria-hidden />
              {t("actions.restore")}
            </Button>
          ),
        }),
      ] as DataTableColumnDef<TrashRowDTO>[],
    [t, tTypes, restore, restoring],
  );

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "entityType",
        label: t("facets.entityType"),
        kind: "options",
        options: TRASHABLE_ENTITY_TYPE_VALUES.map((value) => ({ value, label: tTypes(value) })),
      },
      {
        id: "deleted",
        label: t("facets.deleted"),
        kind: "dateRange",
        fromKey: "deletedFrom",
        toKey: "deletedTo",
      },
    ],
    [t, tTypes],
  );

  return (
    <DataTable<TrashRowDTO>
      data={rows}
      columns={columns}
      getRowId={rowId}
      total={total}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      facets={facets}
      searchPlaceholder={t("search.placeholder")}
      selectable={false}
      emptyState={{ title: t("empty.title"), description: t("empty.description") }}
    />
  );
}
