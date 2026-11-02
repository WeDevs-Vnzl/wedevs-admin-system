import type { ListQuery } from '../../domain/list-query';
import type { PageSize } from '../../domain/pagination';
import type { CurrentUser } from '../current-user';

/** How a column is rendered by the CSV writer; money is written verbatim (DT-171). */
export type ExportColumnType = 'text' | 'integer' | 'money' | 'date' | 'datetime' | 'boolean';

export type ExportCellValue = string | number | boolean | Date | null;

export interface ExportColumn<Row> {
  readonly type: ExportColumnType;
  readonly value: (row: Row) => ExportCellValue;
}

/** One page request over the entity's own list query. */
export interface ExportPage {
  readonly page: number;
  readonly pageSize: PageSize;
}

/**
 * A table that can be exported (DT-171). The owning context registers it; the source authorizes and
 * reads through its own list, so the export sees exactly what the list shows.
 */
export interface ExportSource<Row = unknown> {
  readonly entity: string;
  /** Whitelist of exportable column ids. */
  readonly columns: Readonly<Record<string, ExportColumn<Row>>>;
  read(
    actor: CurrentUser,
    query: Omit<ListQuery, 'page' | 'pageSize'>,
    page: ExportPage,
  ): Promise<{ rows: readonly Row[]; total: number }>;
}

/** Registry of export sources by entity; `register` throws on a duplicate. */
export class ExportSourceRegistry {
  private readonly sources = new Map<string, ExportSource>();

  register<Row>(source: ExportSource<Row>): void {
    if (this.sources.has(source.entity)) {
      throw new Error(`An export source for ${source.entity} is already registered`);
    }
    this.sources.set(source.entity, source as ExportSource);
  }

  get(entity: string): ExportSource | undefined {
    return this.sources.get(entity);
  }

  /** Registered entities in registration order. */
  entities(): string[] {
    return [...this.sources.keys()];
  }
}
