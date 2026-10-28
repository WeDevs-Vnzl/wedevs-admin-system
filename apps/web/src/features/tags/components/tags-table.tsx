"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import { useCsvExport } from "@/features/export/use-csv-export";
import { exportTagsCsvAction, listTagsAction } from "@/features/tags/actions";
import type { ListQuery } from "@/lib/validators/common";
import type { TagListRowDTO } from "@/lib/validators/tags";
import { TagChips } from "./tag-chips";
import { TagFormDialog } from "./tag-form-dialog";

type TagsTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: TagListRowDTO[];
  initialTotal: number;
};

type DialogState = { open: boolean; tag?: TagListRowDTO; key: number };

const helper = createDataTableColumnHelper<TagListRowDTO>();

/** The `/settings/tags` table: colour chip, usage count, created date; sorted, searched and exported server-side. */
export function TagsTable({ initialRows, initialTotal }: TagsTableProps) {
  const t = useTranslations("tags");
  const tErrors = useTranslations("common.errors");
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ open: false, key: 0 });
  const exportCsv = useCsvExport(exportTagsCsvAction, "TAG");

  // The first render already shows the server page for this URL; later query changes read through the action.
  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listTagsAction(next);
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

  const openDialog = useCallback((tag?: TagListRowDTO) => {
    setDialog((current) => ({ open: true, tag, key: current.key + 1 }));
  }, []);

  const columns = useMemo<DataTableColumnDef<TagListRowDTO>[]>(
    () => [
      helper.accessor("name", {
        header: t("columns.name"),
        meta: { label: t("columns.name"), sortable: true, pinned: true },
        cell: ({ row }) => <TagChips tags={[row.original]} />,
      }),
      helper.accessor("usageCount", {
        header: t("columns.usageCount"),
        meta: { label: t("columns.usageCount"), sortable: true },
        cell: ({ row }) => <span className="tabular-nums">{row.original.usageCount}</span>,
      }),
      helper.accessor("createdAt", {
        header: t("columns.createdAt"),
        meta: { label: t("columns.createdAt"), sortable: true },
        cell: ({ row }) => <DateText value={new Date(row.original.createdAt)} />,
      }),
      helper.display({
        id: "actions",
        meta: { label: t("columns.actions"), hideable: false, exportable: false },
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("actions.edit", { name: row.original.name })}
            onClick={() => openDialog(row.original)}
          >
            <PencilIcon aria-hidden />
          </Button>
        ),
      }),
    ],
    [t, openDialog],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => openDialog()}>
          <PlusIcon aria-hidden />
          {t("actions.new")}
        </Button>
      </div>

      <DataTable<TagListRowDTO>
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        total={total}
        query={query}
        onQueryChange={setQuery}
        loading={loading}
        searchPlaceholder={t("search.placeholder")}
        selectable={false}
        onExport={exportCsv}
        emptyState={{
          title: t("empty.title"),
          description: t("empty.description"),
          action: (
            <Button onClick={() => openDialog()}>
              <PlusIcon aria-hidden />
              {t("actions.new")}
            </Button>
          ),
        }}
      />

      <TagFormDialog
        key={dialog.key}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        tag={dialog.tag}
        onSaved={() => void load(query)}
      />
    </div>
  );
}
