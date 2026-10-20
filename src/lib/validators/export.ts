import type { TableFacetDescriptor } from "@/lib/table-query";
import type { CsvColumnType } from "@/lib/csv";
import { z } from "./zod";
import { listQuerySchema, VALIDATION_MESSAGES, type Paginated } from "./common";
import { columnIdSchema } from "./preferences";

/**
 * CSV export contract (PRD §12 `exportCsv(entity, filters, columns)`). The input is the same list query
 * the table sends (`listQuerySchema`: search, filters, sort, archived) plus the column ids the user left
 * visible; display-only columns (selection, actions) are never listed. The serializer is `lib/csv.ts`;
 * there is no central registry: each module declares its own `ExportSource` and builds its action with
 * `defineCsvExportAction` (H1-B2 PD-2). Pure and framework-free.
 */

/** Entities whose list can be exported (each one needs a registry entry in the action). */
export const EXPORT_ENTITY_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "RECURRING_EXPENSE",
  "ACCOUNT_MOVEMENT",
  "DOCUMENT",
  "NOTE",
  "TAG",
  "SHARE_LINK",
  "ACTIVITY",
  "EXCHANGE_RATE",
  // Catalog and settings tables (PRD §8.15), project billing tables (§8.4), accounts (§8.7), users and trash.
  "TECHNOLOGY",
  "DOCUMENT_TYPE",
  "CURRENCY",
  "PAYMENT_METHOD",
  "EXPENSE_CATEGORY",
  "INSTALLMENT",
  "RECURRING_CHARGE",
  "ACCOUNT",
  "USER",
  "TRASH",
] as const;
export const exportEntitySchema = z.enum(EXPORT_ENTITY_VALUES);
export type ExportEntity = z.infer<typeof exportEntitySchema>;

/** Column id as the table knows it: the same `columnIdSchema` the column preferences use. */
export const exportColumnSchema = columnIdSchema;

export const MAX_EXPORT_COLUMNS = 100;

export const exportCsvInputSchema = z.object({
  entity: exportEntitySchema,
  query: listQuerySchema,
  /** Visible data columns, in display order: at least one, no repeats. */
  columns: z
    .array(exportColumnSchema)
    .min(1)
    .max(MAX_EXPORT_COLUMNS)
    .refine((columns) => new Set(columns).size === columns.length, {
      message: VALIDATION_MESSAGES.invalidOption,
    }),
});
export type ExportCsvInput = z.infer<typeof exportCsvInputSchema>;
export type ExportCsvInputRaw = z.input<typeof exportCsvInputSchema>;

/** Row cap of one export (PRD §7.3). Beyond it the file is cut and `truncated` is `true`. */
export const EXPORT_MAX_ROWS = 10_000;

/** What `exportCsv` returns: the file as text, ready for the browser to download as a Blob. */
export const exportCsvResultSchema = z.object({
  filename: z.string().min(1),
  content: z.string(),
  rowCount: z.number().int().nonnegative(),
  /** More rows matched than `EXPORT_MAX_ROWS`; the file holds the first ones. */
  truncated: z.boolean(),
});
export type ExportCsvResultDTO = z.infer<typeof exportCsvResultSchema>;

/** How one exportable column reads its cell. `labelKey` is an i18n key resolved by the action factory. */
export interface ExportColumnSpec<Row> {
  labelKey: string;
  /** `money` cells must be decimal strings and are written verbatim (C15). Defaults to `text`. */
  type?: CsvColumnType;
  value: (row: Row) => unknown;
}

/**
 * What a module supplies to export its table: the facets of its filter (for `toModuleQuery`), the filter
 * schema, the same list service the table uses, and the cell of every column by id. Context is generic so
 * the contract stays framework-free; Hito 1 binds it to the mock context, Hito 2 to the Prisma one.
 */
export interface ExportSource<Row, Filter = unknown, Ctx = unknown> {
  entity: ExportEntity;
  facets: readonly TableFacetDescriptor[];
  filterSchema: z.ZodType<Filter, unknown>;
  list: (ctx: Ctx, filter: Filter) => Promise<Paginated<Row>>;
  columns: Record<string, ExportColumnSpec<Row>>;
}
