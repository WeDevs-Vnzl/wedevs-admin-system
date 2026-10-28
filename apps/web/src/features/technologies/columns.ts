import type { ExportColumnSpec } from "@/lib/validators/export";
import type { TechnologyListRowDTO } from "@/lib/validators/technologies";

/** Column ids the CSV export can write. `icon` is display-only and never exported. */
export const TECHNOLOGY_EXPORT_COLUMN_IDS = [
  "name",
  "nameEn",
  "slug",
  "category",
  "iconSlug",
  "color",
  "usageCount",
  "active",
] as const;

const labelKey = (id: string) => `technologies.table.columns.${id}`;

/** Cells of the CSV export, by column id. Booleans and counts are written as they are (no locale format). */
export const technologyExportColumns: Record<string, ExportColumnSpec<TechnologyListRowDTO>> = {
  name: { labelKey: labelKey("name"), value: (row) => row.name },
  nameEn: { labelKey: labelKey("nameEn"), value: (row) => row.nameEn },
  slug: { labelKey: labelKey("slug"), value: (row) => row.slug },
  category: { labelKey: labelKey("category"), value: (row) => row.category },
  iconSlug: { labelKey: labelKey("iconSlug"), value: (row) => row.iconSlug },
  color: { labelKey: labelKey("color"), value: (row) => row.color },
  usageCount: { labelKey: labelKey("usageCount"), value: (row) => row.usageCount },
  active: { labelKey: labelKey("active"), value: (row) => row.active },
};
