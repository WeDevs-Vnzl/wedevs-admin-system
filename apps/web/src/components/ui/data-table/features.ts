import {
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";

/**
 * Column-level metadata read by the kit. `label` is already translated by the caller; the kit never
 * renders an id as a label. `pinned` pins the column to the left edge on horizontal scroll.
 */
export interface DataTableColumnMeta {
  label?: string;
  /** Sort field sent to the server (`sort=<id>:asc|desc`); the column id is the field. */
  sortable?: boolean;
  /** False for columns that must always stay visible (selection, actions). */
  hideable?: boolean;
  pinned?: boolean;
  /**
   * False for display-only columns (selection, row actions): they never reach `onExport`. The kit sets it on
   * the selection column; callers set it on their actions column.
   */
  exportable?: boolean;
  /** "end" right-aligns header and cells with tabular numbers (money, counts). Default "start". */
  align?: "start" | "end";
  /**
   * True for multi-line cells (badge lists, icon stacks): content wraps inside the column instead of being
   * truncated to one line. Either way the cell clips to its width and never paints into the next column.
   */
  wrap?: boolean;
}

// Only the features the kit uses are registered; server modes bypass client row models (manual flags).
export const dataTableFeatures = tableFeatures({
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  columnMeta: {} as DataTableColumnMeta,
});

export type DataTableFeatures = typeof dataTableFeatures;

/**
 * Cell values differ per column (strings, numbers, money strings…). TanStack's generics are invariant, so a
 * `ColumnDef<…, string>` is not assignable to `ColumnDef<…, unknown>`; the cell value type is left open here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableColumnDef<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>;

export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}
