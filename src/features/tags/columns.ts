import type { ExportColumnSpec } from "@/lib/validators/export";
import type { TagListRowDTO } from "@/lib/validators/tags";

/**
 * CSV cells of the `/settings/tags` table. The table's own columns (with chips and actions) are in
 * `components/tags-table.tsx`; the ids here are the same ones it sorts by and exports (`name`, `usageCount`,
 * `createdAt`). Header labels are keys of the `tags` namespace, resolved by the export action.
 */
export const TAG_EXPORT_COLUMNS: Record<string, ExportColumnSpec<TagListRowDTO>> = {
  name: { labelKey: "columns.name", value: (row) => row.name },
  usageCount: { labelKey: "columns.usageCount", value: (row) => row.usageCount },
  createdAt: { labelKey: "columns.createdAt", value: (row) => row.createdAt },
};
