import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { DateOnly } from '../../../../shared/domain/business-date';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import type { ProjectStatus } from '../../../../shared/domain/enums';
import type { ListQuery, SortSpec } from '../../../../shared/domain/list-query';
import { paginated, type Paginated } from '../../../../shared/domain/pagination';
import type { ProjectListRowView } from '../../domain/project';
import type { ProjectListFilters, ProjectRepository } from '../ports/project.repository.port';
import type { ProjectViews } from './project-views';

const DEFAULT_SORT: SortSpec = { field: 'code', direction: 'desc' };

/** Sort keys that read amounts: they need `canSeeFinancials`, or the order would leak them (C13). */
export const PROJECT_MONEY_SORTS: readonly string[] = [
  'contractedValueUsd',
  'invoicedUsd',
  'collectedUsd',
  'toInvoiceUsd',
];

const values = (raw: string | readonly string[] | undefined): string[] | undefined =>
  raw === undefined ? undefined : Array.isArray(raw) ? [...raw] : [raw as string];

/** Maps the query-string filters of the list (already whitelisted by the DTO) to the repository filter. */
export function projectFiltersOf(query: ListQuery): ProjectListFilters {
  const status = values(query.filters.status) as ProjectStatus[] | undefined;
  const clientIds = values(query.filters.clientId);
  const technologyIds = values(query.filters.technologyId);
  const tagIds = values(query.filters.tagId);
  const deliveryFrom = values(query.filters.deliveryFrom)?.[0] as DateOnly | undefined;
  const deliveryTo = values(query.filters.deliveryTo)?.[0] as DateOnly | undefined;
  const withoutBillingPlan = values(query.filters.withoutBillingPlan)?.includes('true') === true;
  return {
    ...(status ? { status } : {}),
    ...(clientIds ? { clientIds } : {}),
    ...(technologyIds ? { technologyIds } : {}),
    ...(tagIds ? { tagIds } : {}),
    ...(deliveryFrom ? { deliveryFrom } : {}),
    ...(deliveryTo ? { deliveryTo } : {}),
    ...(withoutBillingPlan ? { withoutBillingPlan } : {}),
    ...(query.q !== undefined ? { q: query.q } : {}),
  };
}

/**
 * `GET /projects` (HU-05, HU-06 CA2). `archived=only|include` is honoured only for the trash roles
 * (contract choice 2); money sorts without `canSeeFinancials` are `VALIDATION` on `sort`
 * (`validation.sort.invalid`). Money columns come from `ProjectMetrics` and are `null` without the
 * financial grant.
 */
export class ListProjects {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly projects: ProjectRepository,
    private readonly views: ProjectViews,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<ProjectListRowView>> {
    assertCan(this.authorization, actor, 'read', 'project');
    const sort = query.sort ?? DEFAULT_SORT;
    if (PROJECT_MONEY_SORTS.includes(sort.field) && !this.authorization.canSeeFinancials(actor)) {
      throw new ValidationFailedError({ fieldErrors: { sort: ['validation.sort.invalid'] } });
    }
    const archived =
      query.archived !== 'exclude' && !this.authorization.can(actor, 'restore', 'trash')
        ? 'exclude'
        : query.archived;

    const page = await this.projects.list({
      filters: projectFiltersOf(query),
      archived,
      sort,
      page: query.page,
      pageSize: query.pageSize,
    });
    return paginated(await this.views.rows(actor, page.records), page.total, query);
  }
}
