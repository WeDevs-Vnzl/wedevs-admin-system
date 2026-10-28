import type { CurrentUser } from '../../../../shared/application/current-user';
import type { TechCategory } from '../../../../shared/domain/enums';
import type { ListQuery, SortSpec } from '../../../../shared/domain/list-query';
import { pageWindow, paginated, type Paginated } from '../../../../shared/domain/pagination';
import {
  compareTechnologies,
  filterTechnologies,
  toTechnologyView,
  type TechnologyFilter,
  type TechnologyRecord,
  type TechnologyView,
} from '../../domain/technology';
import type { TechnologyRepository } from '../ports/technology.repository.port';
import type { TechnologyUsagePort } from '../ports/technology-usage.port';

const DEFAULT_SORT: SortSpec = { field: 'name', direction: 'asc' };

/** Maps the query-string filters of the list (already whitelisted by the DTO) to the domain filter. */
export function technologyFilterOf(query: ListQuery): TechnologyFilter {
  const values = (raw: string | readonly string[] | undefined): string[] | undefined =>
    raw === undefined ? undefined : Array.isArray(raw) ? [...raw] : [raw as string];

  const categories = values(query.filters.category) as TechCategory[] | undefined;
  const actives = values(query.filters.active)
    ?.map((value) => (value === 'true' ? true : value === 'false' ? false : undefined))
    .filter((value): value is boolean => value !== undefined);

  return {
    ...(categories !== undefined ? { categories } : {}),
    ...(actives !== undefined && actives.length > 0 ? { actives } : {}),
    ...(query.q !== undefined ? { q: query.q } : {}),
  };
}

/**
 * `GET /technologies` (HU-06 CA1, reference read for every signed-in role, DT-71). Filters, free text and
 * sort run over the catalog; the usage count is read per row through `TechnologyUsagePort`. A sort by
 * usage reads every matching row's count; any other sort reads only the counts of the page.
 */
export class ListTechnologies {
  constructor(
    private readonly technologies: TechnologyRepository,
    private readonly usage: TechnologyUsagePort,
  ) {}

  async execute(_actor: CurrentUser, query: ListQuery): Promise<Paginated<TechnologyView>> {
    const sort = query.sort ?? DEFAULT_SORT;
    const matching = filterTechnologies(
      await this.technologies.findAll(),
      technologyFilterOf(query),
    );
    const compare = compareTechnologies(sort);
    const { skip, take } = pageWindow(query.page, query.pageSize);

    if (sort.field === 'usageCount') {
      const views = await this.withUsage(matching);
      views.sort(compare);
      return paginated(views.slice(skip, skip + take), views.length, query);
    }

    const sorted = [...matching].sort(compare);
    const page = await this.withUsage(sorted.slice(skip, skip + take));
    return paginated(page, sorted.length, query);
  }

  private async withUsage(rows: readonly TechnologyRecord[]): Promise<TechnologyView[]> {
    const views: TechnologyView[] = [];
    for (const row of rows) {
      views.push(toTechnologyView(row, await this.usage.countLiveProjects(row.id)));
    }
    return views;
  }
}
