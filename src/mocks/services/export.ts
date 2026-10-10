// MOCK — CSV export over a module's own list service (PRD §7.3, PD-2). Framework-free (C11). Real services
// do the same in Hito 2 (a streamed query with the same cap). No activity entry: `EXPORT` is logged in H2-B6.
import { toCsv, type CsvColumn } from "@/lib/csv";
import { todayInCaracas } from "@/lib/dates";
import { toModuleQuery } from "@/lib/table-query";
import {
  EXPORT_MAX_ROWS,
  type ExportCsvInput,
  type ExportCsvResultDTO,
  type ExportSource,
} from "@/lib/validators/export";
import { zodFieldErrors } from "@/lib/validators/common";
import { ServiceError, type MockServiceContext } from "../ctx";

/** Rows asked of the module's list service per page (the largest page size the tables offer). */
const EXPORT_PAGE_SIZE = 100;

/**
 * Exports the rows `input.query` selects from `source` as CSV text. `input.columns` picks and orders the
 * columns; `labelKey` of each column is the header and arrives already translated (the action factory
 * resolves it). At most `EXPORT_MAX_ROWS` rows are written; `truncated` says there were more.
 */
export async function exportCsv<Row, Filter>(
  ctx: MockServiceContext,
  input: ExportCsvInput,
  source: ExportSource<Row, Filter, MockServiceContext>,
): Promise<ExportCsvResultDTO> {
  if (input.entity !== source.entity) throw new ServiceError("VALIDATION");

  const columns: CsvColumn[] = [];
  for (const id of input.columns) {
    const spec = Object.hasOwn(source.columns, id) ? source.columns[id] : undefined;
    if (!spec) throw new ServiceError("VALIDATION", { fieldErrors: { columns: [id] } });
    columns.push({ key: id, header: spec.labelKey, ...(spec.type ? { type: spec.type } : {}) });
  }

  const flat = toModuleQuery(input.query, source.facets);
  const rows: Row[] = [];
  let total = 0;
  for (let page = 1; rows.length < EXPORT_MAX_ROWS; page += 1) {
    const parsed = source.filterSchema.safeParse({ ...flat, page, pageSize: EXPORT_PAGE_SIZE });
    if (!parsed.success) {
      throw new ServiceError("VALIDATION", { fieldErrors: zodFieldErrors(parsed.error) });
    }
    const result = await source.list(ctx, parsed.data);
    total = result.total;
    rows.push(...result.items.slice(0, EXPORT_MAX_ROWS - rows.length));
    if (page >= result.pageCount || result.items.length === 0) break;
  }

  // Each cell is read through its column spec, then handed to `toCsv` under the column id.
  const cells = rows.map((row) =>
    Object.fromEntries(input.columns.map((id) => [id, source.columns[id]!.value(row)])),
  );
  const content = toCsv(cells, columns);
  return {
    filename: `${source.entity.toLowerCase()}-${todayInCaracas(ctx.now)}.csv`,
    content,
    rowCount: rows.length,
    truncated: total > EXPORT_MAX_ROWS,
  };
}
