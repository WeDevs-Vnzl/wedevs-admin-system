import type { TableFacetDescriptor } from "@/lib/table-query";
import type { ClientListRowDTO } from "@/lib/validators/clients";
import type { ExportColumnSpec } from "@/lib/validators/export";

/**
 * Columns of the clients table (PRD §8.2 "Tabla"), shared by the W3 table and the CSV export source, so
 * the file offers exactly what the table shows. Pure data: no server code, safe in client components.
 * `labelKey`s are `clients.columns.*` (the export action resolves them under the `clients` namespace).
 */

export const CLIENT_COLUMN_IDS = [
  "code",
  "tradeName",
  "kind",
  "country",
  "status",
  "projectCount",
  "totalInvoicedUsd",
  "receivableUsd",
  "tags",
  "lastActivityAt",
] as const;
export type ClientColumnId = (typeof CLIENT_COLUMN_IDS)[number];

export interface ClientColumnDescriptor {
  id: ClientColumnId;
  /** Key inside the `clients` namespace (`columns.<id>`). */
  labelKey: `columns.${ClientColumnId}`;
  /** USD decimal string, written verbatim to CSV and right-aligned in the table (C15). */
  money: boolean;
  /** Whether `clientFilterSchema` accepts it as a sort field. */
  sortable: boolean;
}

const MONEY_COLUMNS: readonly ClientColumnId[] = ["totalInvoicedUsd", "receivableUsd"];
const UNSORTABLE_COLUMNS: readonly ClientColumnId[] = ["tags"];

export const CLIENT_COLUMNS: readonly ClientColumnDescriptor[] = CLIENT_COLUMN_IDS.map((id) => ({
  id,
  labelKey: `columns.${id}`,
  money: MONEY_COLUMNS.includes(id),
  sortable: !UNSORTABLE_COLUMNS.includes(id),
}));

/**
 * Facets of the clients table, in the ids `toModuleQuery` maps onto `clientFilterSchema` (`tagId` is an
 * async facet; the created range maps to `createdFrom` / `createdTo`).
 */
export const CLIENT_FACETS: readonly TableFacetDescriptor[] = [
  { id: "status", kind: "options" },
  { id: "kind", kind: "options" },
  { id: "country", kind: "options" },
  { id: "tagId", kind: "async" },
  { id: "created", kind: "dateRange", fromKey: "createdFrom", toKey: "createdTo" },
];

/** CSV cell of each column. Enum cells carry the stored value; tags are joined with `; `. */
export const CLIENT_EXPORT_COLUMNS: Record<ClientColumnId, ExportColumnSpec<ClientListRowDTO>> = {
  code: { labelKey: "columns.code", value: (row) => row.code },
  tradeName: { labelKey: "columns.tradeName", value: (row) => row.tradeName },
  kind: { labelKey: "columns.kind", value: (row) => row.kind },
  country: { labelKey: "columns.country", value: (row) => row.country },
  status: { labelKey: "columns.status", value: (row) => row.status },
  projectCount: { labelKey: "columns.projectCount", value: (row) => row.projectCount },
  totalInvoicedUsd: {
    labelKey: "columns.totalInvoicedUsd",
    type: "money",
    value: (row) => row.totalInvoicedUsd,
  },
  receivableUsd: {
    labelKey: "columns.receivableUsd",
    type: "money",
    value: (row) => row.receivableUsd,
  },
  tags: { labelKey: "columns.tags", value: (row) => row.tags.map((tag) => tag.name).join("; ") },
  lastActivityAt: { labelKey: "columns.lastActivityAt", value: (row) => row.lastActivityAt },
};
