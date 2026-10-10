import { z } from "./zod";
import { listQuerySchema, VALIDATION_MESSAGES } from "./common";
import { columnIdSchema } from "./preferences";

/**
 * CSV export contract (PRD §12 `exportCsv(entity, filters, columns)`). The input is the same list query
 * the table sends (`listQuerySchema`: search, filters, sort, archived) plus the column ids the user left
 * visible; display-only columns (selection, actions) are never listed. The serializer is `lib/csv.ts`;
 * the generic `exportCsvAction` with a per-entity registry of queries arrives with the first module list
 * (H1-B2 wave 1). Pure and framework-free.
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
