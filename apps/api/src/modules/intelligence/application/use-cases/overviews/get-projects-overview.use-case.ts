import type { ProjectListRowView } from '../../../../commercial/application/use-cases/project-views';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import type { ProjectStatus } from '../../../../../shared/domain/enums';
import { compareMoney } from '../../../../../shared/domain/money';
import type { EntityMetricsReadPort } from '../../ports/entity-metrics-read.port';
import type { OverviewReadPort, TechnologyUsageRow } from '../../ports/overview-read.port';
import { SHORT_LIST, firstRows, queryOf, type ListSource } from './overview-support';

const TOP_TECHNOLOGIES = 8;

export interface ProjectsOverview {
  countByStatus: Record<ProjectStatus, number>;
  upcomingDeliveries: ProjectListRowView[];
  withoutBillingPlan: ProjectListRowView[];
  topTechnologies: TechnologyUsageRow[];
  highestToInvoice: ProjectListRowView[];
}

/**
 * `GET /projects/overview` (PRD §8.3, DT-174, DT-175). `can(read, project)` first. Rows are the list rows of
 * `ListProjects`, so chips and money gates stay the owner's. Without `canSeeFinancials`, `highestToInvoice`
 * is empty (X15): which project sits in it, and where, would reveal what is left to invoice.
 */
export class GetProjectsOverview {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly projects: ListSource<ProjectListRowView>,
    private readonly metrics: EntityMetricsReadPort,
    private readonly overview: OverviewReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser): Promise<ProjectsOverview> {
    assertCan(this.authorization, actor, 'read', 'project');
    const today = todayInCaracas(this.clock.now());
    const [countByStatus, upcomingDeliveries, withoutBillingPlan, topTechnologies] =
      await Promise.all([
        this.metrics.projectCountsByStatus(),
        firstRows(
          this.projects,
          actor,
          queryOf(
            { field: 'targetEndDate', direction: 'asc' },
            { status: ['EN_CURSO', 'PAUSADO'], deliveryFrom: today },
          ),
          SHORT_LIST,
        ),
        firstRows(
          this.projects,
          actor,
          queryOf({ field: 'code', direction: 'asc' }, { withoutBillingPlan: 'true' }),
          SHORT_LIST,
        ),
        this.overview.topTechnologies(TOP_TECHNOLOGIES),
      ]);

    const highestToInvoice = this.authorization.canSeeFinancials(actor)
      ? (
          await firstRows(
            this.projects,
            actor,
            queryOf({ field: 'toInvoiceUsd', direction: 'desc' }, {}, 25),
            25,
          )
        )
          .filter((row) => row.toInvoiceUsd !== null && compareMoney(row.toInvoiceUsd, '0') > 0)
          .slice(0, SHORT_LIST)
      : [];

    return {
      countByStatus,
      upcomingDeliveries,
      withoutBillingPlan,
      topTechnologies,
      highestToInvoice,
    };
  }
}
