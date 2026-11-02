import type { CurrentUser } from '../../../../../shared/application/current-user';
import { actorOf } from '../../../../../shared/application/actor';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type {
  ExportCellValue,
  ExportColumn,
  ExportSourceRegistry,
} from '../../../../../shared/application/ports/export-source.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { NotFoundError, ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { EntityType } from '../../../../../shared/domain/enums';
import type { ListQuery } from '../../../../../shared/domain/list-query';
import { toCsv, type CsvColumn } from '../../../domain/csv';

/** Tables whose list can be exported (DT-171). Other values of the FE enum have no BE source. */
export const EXPORT_ENTITY_VALUES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'NOTE',
  'TAG',
  'TECHNOLOGY',
  'ACTIVITY',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'DOCUMENT',
] as const;
export type ExportEntity = (typeof EXPORT_ENTITY_VALUES)[number];

/** Row cap of one file (PRD §7.3). */
export const EXPORT_MAX_ROWS = 10_000;
/** Rows asked of the source per page, the largest page size the lists offer. */
export const EXPORT_PAGE_SIZE = 100;
export const EXPORT_MAX_COLUMNS = 100;
/** Header labels come from the client and are written, never stored (A16). */
export const EXPORT_LABEL_MAX = 200;

/** Activity entity type of each export; tables with no entity type of their own log under `SETTING`. */
const ACTIVITY_ENTITY: Record<ExportEntity, EntityType> = {
  CLIENT: 'CLIENT',
  CONTACT: 'CONTACT',
  PROJECT: 'PROJECT',
  NOTE: 'NOTE',
  TAG: 'TAG',
  TECHNOLOGY: 'SETTING',
  ACTIVITY: 'SETTING',
  INVOICE: 'INVOICE',
  PAYMENT: 'PAYMENT',
  EXPENSE: 'EXPENSE',
  DOCUMENT: 'DOCUMENT',
};

export interface ExportColumnInput {
  readonly id: string;
  readonly label: string;
}

export interface ExportCsvInput {
  readonly entity: string;
  /** The list query of the table, without paging. */
  readonly query: Omit<ListQuery, 'page' | 'pageSize'>;
  readonly columns: readonly ExportColumnInput[];
}

export interface ExportCsvResult {
  readonly filename: string;
  readonly content: string;
  readonly rowCount: number;
  /** More rows matched than `EXPORT_MAX_ROWS`; the file holds the first ones. */
  readonly truncated: boolean;
}

function isExportEntity(value: string): value is ExportEntity {
  return (EXPORT_ENTITY_VALUES as readonly string[]).includes(value);
}

function invalid(field: string, key: string): ValidationFailedError {
  return new ValidationFailedError({ fieldErrors: { [field]: [key] } });
}

/** Dates are business dates; datetimes are instants in ISO 8601 UTC. Everything else goes to `toCsv` as is. */
function cellOf(column: ExportColumn<unknown>, value: ExportCellValue): unknown {
  if (value instanceof Date) {
    const iso = value.toISOString();
    return column.type === 'date' ? iso.slice(0, 10) : iso;
  }
  return value;
}

/**
 * `ExportCsv` (PRD §12 `exportCsv`, DT-171): server-side CSV of one table.
 *
 * Authorization lives in the source: its `read` is the table's own list use case, so that list's `can()`
 * and money gates decide what the file holds. Columns are validated before anything is read; the rows are
 * read in pages of 100 up to the cap; the single `EXPORT` entry is written in a unit of work after them,
 * with the entity, the row count, the column ids and `truncated`, and no filter value or label.
 */
export class ExportCsv {
  constructor(
    private readonly registry: ExportSourceRegistry,
    private readonly uow: UnitOfWorkPort,
    private readonly activity: ActivityLogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(user: CurrentUser, input: ExportCsvInput): Promise<ExportCsvResult> {
    if (!isExportEntity(input.entity)) throw invalid('entity', 'validation.invalidOption');
    const entity = input.entity;
    const source = this.registry.get(entity);
    if (!source) throw new NotFoundError();

    const resolved = this.resolveColumns(source.columns, input.columns);
    const ids = resolved.map((column) => column.id);

    const rows: unknown[] = [];
    let total = 0;
    for (let page = 1; rows.length < EXPORT_MAX_ROWS; page += 1) {
      const result = await source.read(user, input.query, { page, pageSize: EXPORT_PAGE_SIZE });
      total = result.total;
      rows.push(...result.rows.slice(0, EXPORT_MAX_ROWS - rows.length));
      if (result.rows.length === 0 || page * EXPORT_PAGE_SIZE >= total) break;
    }
    const truncated = total > EXPORT_MAX_ROWS;

    // Cells are keyed by position: `toCsv` reads dotted keys as paths and ids may contain dots.
    const csvColumns: CsvColumn[] = resolved.map((column, index) => ({
      key: String(index),
      header: column.label,
      type: column.spec.type === 'money' ? 'money' : 'text',
    }));
    const cells = rows.map((row) =>
      resolved.map((column) => cellOf(column.spec, column.spec.value(row))),
    );
    const content = toCsv(cells, csvColumns);

    await this.uow.run(() =>
      this.activity.record({
        actor: actorOf(user),
        action: 'EXPORT',
        entityType: ACTIVITY_ENTITY[entity],
        entityId: entity,
        entityLabel: entity,
        metadata: { entity, rowCount: rows.length, columns: ids, truncated },
      }),
    );

    return {
      filename: `${entity.toLowerCase()}-${todayInCaracas(this.clock.now())}.csv`,
      content,
      rowCount: rows.length,
      truncated,
    };
  }

  private resolveColumns(
    whitelist: Readonly<Record<string, ExportColumn<unknown>>>,
    requested: readonly ExportColumnInput[],
  ): { id: string; label: string; spec: ExportColumn<unknown> }[] {
    if (requested.length === 0 || requested.length > EXPORT_MAX_COLUMNS) {
      throw invalid('columns', 'validation.invalidOption');
    }
    const seen = new Set<string>();
    const resolved: { id: string; label: string; spec: ExportColumn<unknown> }[] = [];
    for (const { id, label } of requested) {
      const column = Object.hasOwn(whitelist, id) ? whitelist[id] : undefined;
      if (!column || seen.has(id)) throw invalid('columns', 'validation.invalidOption');
      if (label.length === 0 || label.length > EXPORT_LABEL_MAX) {
        throw invalid('columns', 'validation.invalidFormat');
      }
      seen.add(id);
      resolved.push({ id, label, spec: column });
    }
    return resolved;
  }
}
