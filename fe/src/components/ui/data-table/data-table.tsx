"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  ColumnPinningPosition,
  ColumnSizingState,
  RowData,
  RowSelectionState,
  SortingState,
  Updater,
} from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { parseSort, type ListQuery } from "@/lib/validators/common";
import { DataTableBulkBar } from "./data-table-bulk-bar";
import { DataTableEmptyState } from "./data-table-empty-state";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableSkeleton } from "./data-table-skeleton";
import { DataTableToolbar } from "./data-table-toolbar";
import { createDataTableColumnHelper, dataTableFeatures, type DataTableColumnDef } from "./features";
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH, defaultColumnConfig, resolveColumnConfig, visibleColumnIds } from "./column-config";
import type { ViewColumn } from "./data-table-view-options";
import type { ColumnConfig, DataTableEmptyConfig, FacetConfig, ListQueryPatch } from "./types";

const SELECT_COLUMN_WIDTH = 40;

export interface DataTableProps<TData extends RowData> {
  /** Rows of the current server page. */
  data: TData[];
  /** Column definitions; each needs an `id` or an `accessorKey`. Sort fields are the column ids. */
  columns: DataTableColumnDef<TData>[];
  getRowId: (row: TData) => string;
  /** Total of the filtered set (not the page), from the server result. */
  total: number;
  /** Current list query, usually from `useTableUrlState`. */
  query: ListQuery;
  onQueryChange: (patch: ListQueryPatch) => void;
  loading?: boolean;
  facets?: FacetConfig[];
  searchPlaceholder?: string;
  /** Shows the "Mostrar archivados" toggle; only Owner/Admin pages pass `true`. */
  showArchivedToggle?: boolean;
  /** Prepends the selection column and enables the bulk bar. Default `true`. */
  selectable?: boolean;
  /** Bulk-action slot, rendered with the selected ids. */
  bulkActions?: (selectedIds: string[]) => ReactNode;
  /** Export button handler: receives the query and the visible column ids (in display order), without display-only columns (`meta.exportable === false`). */
  onExport?: (query: ListQuery, visibleColumns: string[]) => void;
  emptyState: DataTableEmptyConfig;
  /** Saved column state; merged with the definitions by `resolveColumnConfig`. */
  initialColumns?: ColumnConfig[];
  /** Called with the whole config after every visibility, order or width change. */
  onColumnsChange?: (columns: ColumnConfig[]) => void;
}

/**
 * Server-side table (TanStack Table v9, manual pagination/sorting). The URL query is the source of truth;
 * the table never filters or pages the rows it receives.
 */
export function DataTable<TData extends RowData>({
  data,
  columns,
  getRowId,
  total,
  query,
  onQueryChange,
  loading = false,
  facets = [],
  searchPlaceholder,
  showArchivedToggle = false,
  selectable = true,
  bulkActions,
  onExport,
  emptyState,
  initialColumns,
  onColumnsChange,
}: DataTableProps<TData>) {
  const t = useTranslations("table");
  const helper = createDataTableColumnHelper<TData>();

  const selectColumn = useMemo(
    () =>
      helper.display({
        id: "select",
        meta: { hideable: false, exportable: false, label: t("select.column") },
        // Fixed 40px: the shared default `minSize` would otherwise widen it, and it cannot be resized.
        size: SELECT_COLUMN_WIDTH,
        minSize: SELECT_COLUMN_WIDTH,
        maxSize: SELECT_COLUMN_WIDTH,
        enableResizing: false,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
            aria-label={t("select.all")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
            aria-label={t("select.row", { id: row.id })}
          />
        ),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helper is a stateless factory
    [t],
  );

  const allColumns = useMemo<DataTableColumnDef<TData>[]>(
    () => (selectable ? [selectColumn, ...columns] : columns),
    [selectable, selectColumn, columns],
  );

  const descriptors = useMemo(
    () => allColumns.map((def) => ({ id: columnIdOf(def), hideable: def.meta?.hideable !== false })),
    [allColumns],
  );
  const defaults = useMemo(() => defaultColumnConfig(descriptors), [descriptors]);
  const viewColumns: ViewColumn[] = useMemo(
    () =>
      allColumns.map((def) => ({
        id: columnIdOf(def),
        label: def.meta?.label ?? columnIdOf(def),
        hideable: def.meta?.hideable !== false,
      })),
    [allColumns],
  );

  const [config, setConfig] = useState<ColumnConfig[]>(() => resolveColumnConfig(descriptors, initialColumns));
  const updateConfig = (next: ColumnConfig[]) => {
    setConfig(next);
    onColumnsChange?.(next);
  };

  // Selection belongs to one query scope; any page, search, filter or sort change clears it.
  const scope = JSON.stringify([query.page, query.pageSize, query.sort, query.q, query.filters, query.includeArchived]);
  const [selection, setSelection] = useState<{ scope: string; ids: RowSelectionState }>({ scope, ids: {} });
  const rowSelection = selection.scope === scope ? selection.ids : {};
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  const sorted = parseSort(query.sort);
  const sorting: SortingState = sorted ? [{ id: sorted.field, desc: sorted.direction === "desc" }] : [];
  const columnVisibility = Object.fromEntries(config.map((column) => [column.id, column.visible]));
  const columnOrder = config.map((column) => column.id);
  const columnSizing: ColumnSizingState = Object.fromEntries(
    config.flatMap((column) => (column.width === undefined || column.id === "select" ? [] : [[column.id, column.width]])),
  );
  const pinnedData = allColumns
    .filter((def) => def.meta?.pinned)
    .map(columnIdOf)
    .filter((id) => config.find((column) => column.id === id)?.visible !== false);
  // Pinning moves columns to the start; the selection column joins the pinned block so it stays first and the
  // pinned data columns stack after it instead of sliding over it.
  const pinned = selectable && pinnedData.length > 0 ? ["select", ...pinnedData] : pinnedData;

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns: allColumns,
    getRowId: (row) => getRowId(row),
    rowCount: total,
    manualPagination: true,
    manualSorting: true,
    autoResetPageIndex: false,
    columnResizeMode: "onChange",
    defaultColumn: { size: DEFAULT_COLUMN_WIDTH, minSize: MIN_COLUMN_WIDTH },
    state: {
      sorting,
      pagination: { pageIndex: query.page - 1, pageSize: query.pageSize },
      rowSelection,
      columnVisibility,
      columnOrder,
      columnSizing,
      columnPinning: { start: pinned, end: [] },
    },
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      setSelection({ scope, ids: next });
    },
    onColumnSizingChange: (updater: Updater<ColumnSizingState>) => {
      const next = typeof updater === "function" ? updater(columnSizing) : updater;
      updateConfig(config.map((column) => (next[column.id] === undefined ? column : { ...column, width: next[column.id] })));
    },
    onSortingChange: () => undefined,
    onPaginationChange: () => undefined,
  });

  /** Click on a sortable header: asc → desc → none, reported to the server through `sort`. */
  const toggleSort = (field: string) => {
    if (sorted?.field !== field) return onQueryChange({ sort: `${field}:asc` });
    if (sorted.direction === "asc") return onQueryChange({ sort: `${field}:desc` });
    return onQueryChange({ sort: undefined });
  };

  const visibleIds = visibleColumnIds(config);
  const exportIds = new Set(allColumns.filter((def) => def.meta?.exportable !== false).map(columnIdOf));
  const exportableIds = visibleIds.filter((id) => exportIds.has(id));
  const visibleCount = visibleIds.length;
  const hasRows = data.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <DataTableToolbar
        query={query}
        onQueryChange={onQueryChange}
        facets={facets}
        searchPlaceholder={searchPlaceholder}
        showArchivedToggle={showArchivedToggle}
        viewColumns={viewColumns}
        columnConfig={config}
        defaultColumnConfig={defaults}
        onColumnConfigChange={updateConfig}
        onExport={onExport ? () => onExport(query, exportableIds) : undefined}
      />

      {selectable && selectedIds.length > 0 ? (
        <DataTableBulkBar count={selectedIds.length} onClear={() => setSelection({ scope, ids: {} })}>
          {bulkActions?.(selectedIds)}
        </DataTableBulkBar>
      ) : null}

      {/* The shadcn Table wrapper gets overflow-visible so this element scrolls both ways and the header sticks. */}
      <div className="max-h-[70vh] overflow-auto rounded-xl border bg-card [&_[data-slot=table-container]]:overflow-visible">
        <Table className="table-fixed" style={{ width: table.getTotalSize(), minWidth: "100%" }}>
          <TableHeader className="sticky top-0 z-20 bg-background shadow-[inset_0_-1px_0_var(--border)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const def = header.column.columnDef;
                  const id = header.column.id;
                  const label = def.meta?.label ?? id;
                  const isSorted = sorted?.field === id ? sorted.direction : undefined;
                  const sortable = def.meta?.sortable === true;
                  const end = def.meta?.align === "end";
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "relative overflow-hidden",
                        end && "text-right",
                        pinnedClass(header.column.getIsPinned(), header.column.getIsLastColumn("start")),
                      )}
                      style={pinnedStyle(header.column.getIsPinned(), header.column.getStart("start"), header.getSize())}
                    >
                      {header.isPlaceholder ? null : (
                        <div className={cn("flex min-w-0 items-center gap-1", end && "justify-end")}>
                          {sortable ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn("h-8 max-w-full min-w-0", end ? "-mr-2" : "-ml-2")}
                              onClick={() => toggleSort(id)}
                              aria-label={t("sort.by", { column: label })}
                            >
                              <span className="truncate" title={label}>
                                <table.FlexRender header={header} />
                              </span>
                              <SortIcon direction={isSorted} />
                            </Button>
                          ) : (
                            <span className="truncate" title={label}>
                              <table.FlexRender header={header} />
                            </span>
                          )}
                        </div>
                      )}
                      {header.column.getCanResize() ? (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={t("columns.resize", { column: label })}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            "absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none select-none hover:bg-border",
                            header.column.getIsResizing() && "bg-primary",
                          )}
                        />
                      ) : null}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          {loading ? (
            <DataTableSkeleton columnCount={visibleCount} />
          ) : (
            <TableBody>
              {hasRows ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "overflow-hidden",
                          cell.column.columnDef.meta?.wrap ? "whitespace-normal" : "truncate",
                          cell.column.columnDef.meta?.align === "end" && "text-right tabular-nums",
                          pinnedClass(cell.column.getIsPinned(), cell.column.getIsLastColumn("start")),
                        )}
                        style={pinnedStyle(cell.column.getIsPinned(), cell.column.getStart("start"), cell.column.getSize())}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={Math.max(1, visibleCount)}>
                    <DataTableEmptyState {...emptyState} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          )}
        </Table>
      </div>

      <DataTablePagination
        page={query.page}
        pageSize={query.pageSize}
        total={total}
        clamp={!loading}
        onPageChange={(page) => onQueryChange({ page })}
        onPageSizeChange={(pageSize) => onQueryChange({ pageSize, page: 1 })}
      />
    </div>
  );
}

/** Column id: explicit `id`, else the accessor key. Columns without either are a definition error. */
function columnIdOf<TData extends RowData>(def: DataTableColumnDef<TData>): string {
  if (typeof def.id === "string") return def.id;
  if ("accessorKey" in def && typeof def.accessorKey === "string") return def.accessorKey;
  throw new Error("DataTable columns need an id or an accessorKey");
}

/** Pinned cells stick and cover what scrolls under them; the last one draws the block's edge as an inset shadow. */
function pinnedClass(position: ColumnPinningPosition, isLastPinned: boolean): string | undefined {
  if (!position) return undefined;
  return cn("sticky z-10 bg-background", isLastPinned && "shadow-[inset_-1px_0_0_var(--border)]");
}

function pinnedStyle(position: ColumnPinningPosition, start: number, size: number): CSSProperties {
  return position ? { left: start, width: size, minWidth: size, maxWidth: size } : { width: size, minWidth: size, maxWidth: size };
}

function SortIcon({ direction }: { direction: "asc" | "desc" | undefined }) {
  if (direction === "asc") return <ArrowUp aria-hidden />;
  if (direction === "desc") return <ArrowDown aria-hidden />;
  return <ArrowUpDown aria-hidden className="text-muted-foreground" />;
}
