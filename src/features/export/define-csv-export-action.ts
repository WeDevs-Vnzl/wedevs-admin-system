import { getTranslations } from "next-intl/server";
import { z } from "@/lib/validators/zod";
import {
  exportCsvInputSchema,
  type ExportCsvInput,
  type ExportCsvResultDTO,
  type ExportEntity,
  type ExportSource,
} from "@/lib/validators/export";
import { defineAction, type ActionPermission } from "@/server/actions/define-action";
import type { ServiceContext } from "@/server/context";

/**
 * Builds the CSV export Server Action of one module table (PD-2, C10). The module supplies its `source`
 * (the same list service and filter schema the table uses) and its `permission`, which must be a real
 * `can()` grant (DT-71), never `"authenticated"`. The service is injected (`exportCsv` from
 * `@/mocks/services/export` today) so this file never imports `@/mocks` (C9).
 *
 * Headers are resolved here, in the user's language: every column's `labelKey` is replaced by its
 * translation under `namespace`, which is what the service writes as the header cell.
 */
export function defineCsvExportAction<Row, Filter>(config: {
  entity: ExportEntity;
  permission: ActionPermission;
  source: ExportSource<Row, Filter, ServiceContext>;
  exportCsv: (
    ctx: ServiceContext,
    input: ExportCsvInput,
    source: ExportSource<Row, Filter, ServiceContext>,
  ) => Promise<ExportCsvResultDTO>;
  /** next-intl namespace the column `labelKey`s live in (`"clients.table.columns"`). */
  namespace: string;
}) {
  const { entity, permission, source, exportCsv, namespace } = config;
  if (source.entity !== entity) {
    throw new Error(`defineCsvExportAction: source is for ${source.entity}, not ${entity}.`);
  }
  const input = exportCsvInputSchema.extend({ entity: z.literal(entity) });

  return defineAction({
    permission,
    input,
    handler: async (ctx, data) => {
      const t = await getTranslations(namespace);
      const columns = Object.fromEntries(
        Object.entries(source.columns).map(([id, spec]) => [
          id,
          { ...spec, labelKey: t(spec.labelKey as never) },
        ]),
      );
      return exportCsv(ctx, data, { ...source, columns });
    },
  });
}
