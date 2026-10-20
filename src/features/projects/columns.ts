import type { TableFacetDescriptor } from "@/lib/table-query";
import type { ExportColumnSpec } from "@/lib/validators/export";
import type { ProjectListRowDTO } from "@/lib/validators/projects";

/**
 * Columns of the projects table (PRD §8.3 "Tabla"). One list for the W3 table and the CSV export source, so
 * both agree on ids and labels. `labelKey` lives in the `projects` namespace (`columns.<id>`). Money
 * columns are USD decimal strings (C15) and only finance roles see them (the screen decides, PRD §11).
 */
export const PROJECT_COLUMN_IDS = [
  "code",
  "name",
  "clients",
  "status",
  "startDate",
  "targetEndDate",
  "stack",
  "contractedValueUsd",
  "invoicedUsd",
  "collectedUsd",
  "toInvoiceUsd",
  "tags",
] as const;
export type ProjectColumnId = (typeof PROJECT_COLUMN_IDS)[number];

export interface ProjectColumn {
  id: ProjectColumnId;
  labelKey: `columns.${ProjectColumnId}`;
  /** USD decimal string: right-aligned, written verbatim to CSV. */
  money: boolean;
  /** Whether `projectFilterSchema` can sort by it (`PROJECT_SORT_FIELDS`). */
  sortable: boolean;
}

const MONEY_COLUMN_IDS: readonly ProjectColumnId[] = [
  "contractedValueUsd",
  "invoicedUsd",
  "collectedUsd",
  "toInvoiceUsd",
];
const SORTABLE_COLUMN_IDS: readonly ProjectColumnId[] = [
  "code",
  "name",
  "status",
  "startDate",
  "targetEndDate",
  ...MONEY_COLUMN_IDS,
];

export const PROJECT_COLUMNS: readonly ProjectColumn[] = PROJECT_COLUMN_IDS.map((id) => ({
  id,
  labelKey: `columns.${id}`,
  money: MONEY_COLUMN_IDS.includes(id),
  sortable: SORTABLE_COLUMN_IDS.includes(id),
}));

export const PROJECT_MONEY_COLUMN_IDS: readonly ProjectColumnId[] = MONEY_COLUMN_IDS;

/**
 * Facet ids of the table, as `toModuleQuery` needs them to flatten the kit's query into `projectFilterSchema`.
 * `technologyId` is a facet (HU-06 CA2); the delivery window maps to `deliveryFrom` / `deliveryTo`.
 */
export const PROJECT_FACETS: readonly TableFacetDescriptor[] = [
  { id: "status", kind: "options" },
  { id: "clientId", kind: "async" },
  { id: "technologyId", kind: "options" },
  { id: "tagId", kind: "options" },
  { id: "delivery", kind: "dateRange", fromKey: "deliveryFrom", toKey: "deliveryTo" },
  { id: "withoutBillingPlan", kind: "options" },
];

const names = (items: readonly { name: string }[]) => items.map((item) => item.name).join("; ");

/** Cell of every exportable column. Lists are joined with `; `; the status is the enum value. */
export const PROJECT_EXPORT_COLUMNS: Record<
  ProjectColumnId,
  ExportColumnSpec<ProjectListRowDTO>
> = {
  code: { labelKey: "columns.code", value: (row) => row.code },
  name: { labelKey: "columns.name", value: (row) => row.name },
  clients: {
    labelKey: "columns.clients",
    value: (row) =>
      row.clients
        .map(({ client, role }) => (role ? `${client.label} (${role})` : client.label))
        .join("; "),
  },
  status: { labelKey: "columns.status", value: (row) => row.status },
  startDate: { labelKey: "columns.startDate", value: (row) => row.startDate },
  targetEndDate: { labelKey: "columns.targetEndDate", value: (row) => row.targetEndDate },
  stack: { labelKey: "columns.stack", value: (row) => names(row.stack) },
  contractedValueUsd: {
    labelKey: "columns.contractedValueUsd",
    type: "money",
    value: (row) => row.contractedValueUsd,
  },
  invoicedUsd: { labelKey: "columns.invoicedUsd", type: "money", value: (row) => row.invoicedUsd },
  collectedUsd: {
    labelKey: "columns.collectedUsd",
    type: "money",
    value: (row) => row.collectedUsd,
  },
  toInvoiceUsd: {
    labelKey: "columns.toInvoiceUsd",
    type: "money",
    value: (row) => row.toInvoiceUsd,
  },
  tags: { labelKey: "columns.tags", value: (row) => names(row.tags) },
};
