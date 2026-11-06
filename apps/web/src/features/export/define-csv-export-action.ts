import { getTranslations } from "next-intl/server";
import { apiAction } from "@/lib/api/action";
import { toApiListParams } from "@/lib/api/list-params";
import type { ExportApiEntity, ExportBodyDto } from "@/lib/api/types/export";
import { errorMessageKey, type ActionResult } from "@/lib/validators/common";
import { z } from "@/lib/validators/zod";
import {
  exportCsvInputSchema,
  type ExportCsvInput,
  type ExportCsvInputRaw,
  type ExportCsvResultDTO,
  type ExportEntity,
  type ExportSource,
} from "@/lib/validators/export";
import type { ActionPermission } from "@/server/actions/define-action";
import type { ServiceContext } from "@/server/context";

/** Entities the BE exports (`exportCsv` path enum); the record keeps this list exhaustive. */
const API_EXPORT_ENTITIES: Record<ExportApiEntity, true> = {
  CLIENT: true,
  CONTACT: true,
  PROJECT: true,
  NOTE: true,
  TAG: true,
  TECHNOLOGY: true,
  ACTIVITY: true,
  INVOICE: true,
  PAYMENT: true,
  EXPENSE: true,
  DOCUMENT: true,
};

function isApiExportEntity(entity: string): entity is ExportApiEntity {
  return Object.hasOwn(API_EXPORT_ENTITIES, entity);
}

/** File name from `Content-Disposition`, else `<entity>-<yyyy-mm-dd>.csv`. */
function fileNameOf(response: Response, entity: string): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return `${entity.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
}

const FILTER_RESERVED = new Set(["page", "pageSize", "sort", "q", "archived"]);

/**
 * Builds the CSV export Server Action of one module table (C10). It posts the table's current query and
 * the visible columns, labelled in the active locale under `namespace` (DT-171), to
 * `POST /api/v1/exports/{entity}`; the BE builds the CSV, the row cap and the `can()` decision. The
 * response headers `X-Export-Row-Count`, `X-Export-Truncated` and `Content-Disposition` become the
 * `ExportCsvResultDTO` the table hook expects.
 *
 * The config keeps its shape for the six callers (activity, clients, notes, projects, tags,
 * technologies): `source.list`, `source.columns[].value` and `exportCsv` are ignored, and `permission` is
 * cosmetic (the BE decides). The source still provides `columns[].labelKey` and `facets`.
 */
export function defineCsvExportAction<Row, Filter>(config: {
  entity: ExportEntity;
  /** Cosmetic since the swap: the BE `can()` is the rule. */
  permission: ActionPermission;
  // MOCK — until cleanup: `source.list` is ignored; only `columns[].labelKey` and `facets` are read.
  source: ExportSource<Row, Filter, ServiceContext>;
  // MOCK — until cleanup: ignored; the BE builds the file.
  exportCsv: (
    ctx: ServiceContext,
    input: ExportCsvInput,
    source: ExportSource<Row, Filter, ServiceContext>,
  ) => Promise<ExportCsvResultDTO>;
  /** next-intl namespace the column `labelKey`s live in (`"clients.table.columns"`). */
  namespace: string;
}): (input: ExportCsvInputRaw) => Promise<ActionResult<ExportCsvResultDTO>> {
  const { entity, source, namespace } = config;
  if (source.entity !== entity) {
    throw new Error(`defineCsvExportAction: source is for ${source.entity}, not ${entity}.`);
  }
  if (!isApiExportEntity(entity)) {
    throw new Error(`defineCsvExportAction: ${entity} is not exportable through the API.`);
  }
  const apiEntity: ExportApiEntity = entity;
  const input = exportCsvInputSchema.extend({ entity: z.literal(entity) });

  const send = apiAction<ExportCsvInput, ExportCsvResultDTO>({
    call: async (data, api) => {
      const t = await getTranslations(namespace);
      const params = toApiListParams(data.query, { facets: source.facets });
      const filters: ExportBodyDto["query"]["filters"] = {};
      for (const [key, value] of Object.entries(params)) {
        if (FILTER_RESERVED.has(key) || value === undefined) continue;
        filters[key] = typeof value === "number" ? String(value) : value;
      }
      const body: ExportBodyDto = {
        columns: data.columns.map((id) => {
          const spec = source.columns[id];
          return { id, label: spec ? t(spec.labelKey as never) : id };
        }),
        query: {
          archived: params.archived,
          filters,
          ...(params.q !== undefined && { q: params.q }),
          ...(params.sort !== undefined && { sort: params.sort }),
        },
      };
      const { data: text, error, response } = await api.POST("/api/v1/exports/{entity}", {
        params: { path: { entity: apiEntity } },
        body,
        parseAs: "text",
      });
      if (error !== undefined || !response.ok || text === undefined) {
        return { error: error ?? {}, response };
      }
      return {
        data: {
          filename: fileNameOf(response, entity),
          content: text as string,
          rowCount: Number(response.headers.get("X-Export-Row-Count") ?? 0) || 0,
          truncated: response.headers.get("X-Export-Truncated") === "true",
        },
        response,
      };
    },
  });

  return async (raw) => {
    const parsed = input.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
    }
    return send(parsed.data);
  };
}
