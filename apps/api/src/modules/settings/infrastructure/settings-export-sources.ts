import type { CurrentUser } from '../../../shared/application/current-user';
import type {
  ExportColumn,
  ExportPage,
  ExportSource,
} from '../../../shared/application/ports/export-source.port';
import type { ListQuery } from '../../../shared/domain/list-query';
import type { Paginated } from '../../../shared/domain/pagination';
import type { TechnologyView } from '../domain/technology';
import type { ListTags, TagOutput } from '../application/use-cases/list-tags.use-case';
import type { ListTechnologies } from '../application/use-cases/list-technologies.use-case';

/** A table's list use case: the export reads through it, so its rules apply (DT-171). */
interface ListUseCase<Row> {
  execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<Row>>;
}

async function readThrough<Row>(
  list: ListUseCase<Row>,
  actor: CurrentUser,
  query: Omit<ListQuery, 'page' | 'pageSize'>,
  page: ExportPage,
): Promise<{ rows: readonly Row[]; total: number }> {
  const result = await list.execute(actor, { ...query, page: page.page, pageSize: page.pageSize });
  return { rows: result.items, total: result.total };
}

/**
 * The tags table as a CSV export source (DT-171). The columns are the table's own (`name`, `usageCount`,
 * `createdAt`); the rows come from `ListTags` with the same query, a reference read for every signed-in role
 * (DT-71), so the export is exactly what the list shows.
 */
export class TagsExportSource implements ExportSource<TagOutput> {
  readonly entity = 'TAG';

  readonly columns: Readonly<Record<string, ExportColumn<TagOutput>>> = {
    name: { type: 'text', value: (row) => row.name },
    usageCount: { type: 'integer', value: (row) => row.usageCount },
    createdAt: { type: 'datetime', value: (row) => row.createdAt },
  };

  constructor(private readonly listTags: Pick<ListTags, 'execute'>) {}

  read(actor: CurrentUser, query: Omit<ListQuery, 'page' | 'pageSize'>, page: ExportPage) {
    return readThrough(this.listTags, actor, query, page);
  }
}

/**
 * The technologies table as a CSV export source (DT-171). The columns are the FE's export ids; the icon is
 * display-only and not offered. Rows come from `ListTechnologies`, a reference read for every signed-in role.
 */
export class TechnologiesExportSource implements ExportSource<TechnologyView> {
  readonly entity = 'TECHNOLOGY';

  readonly columns: Readonly<Record<string, ExportColumn<TechnologyView>>> = {
    name: { type: 'text', value: (row) => row.name },
    nameEn: { type: 'text', value: (row) => row.nameEn },
    slug: { type: 'text', value: (row) => row.slug },
    category: { type: 'text', value: (row) => row.category },
    iconSlug: { type: 'text', value: (row) => row.iconSlug },
    color: { type: 'text', value: (row) => row.color },
    usageCount: { type: 'integer', value: (row) => row.usageCount },
    active: { type: 'boolean', value: (row) => row.active },
  };

  constructor(private readonly listTechnologies: Pick<ListTechnologies, 'execute'>) {}

  read(actor: CurrentUser, query: Omit<ListQuery, 'page' | 'pageSize'>, page: ExportPage) {
    return readThrough(this.listTechnologies, actor, query, page);
  }
}
