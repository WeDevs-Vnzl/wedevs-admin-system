import type { CurrentUser } from '../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import type {
  ProjectDetailView,
  ProjectFinancialHeadline,
  ProjectListRowView,
  ProjectRecord,
  TagChipView,
  TechnologyChipView,
} from '../../domain/project';
import { sortLinks } from '../../domain/project-link';
import type { ProjectBillingPort } from '../ports/project-billing.port';
import type { ProjectTechnologyCatalogPort } from '../ports/project-technology-catalog.port';
import type { ProjectMetricsRow, ProjectRepository } from '../ports/project.repository.port';

/** Output models of the project use cases; the interface layer reads them from here, never the domain. */
export type {
  ArchivedProjectView,
  ProjectDetailView,
  ProjectListRowView,
  ProjectStatusChangeView,
} from '../../domain/project';
export type { ProjectLinkRecord } from '../../domain/project-link';

const ZERO: ProjectMetricsRow = {
  contractedValueUsd: '0.00',
  invoicedUsd: '0.00',
  collectedUsd: '0.00',
  toInvoiceUsd: '0.00',
};

const NO_FINANCIALS: ProjectFinancialHeadline = {
  contractedValueUsd: null,
  invoicedUsd: null,
  collectedUsd: null,
  toInvoiceUsd: null,
};

/**
 * Assembles the list rows and the detail from records plus the neighbouring reads: client refs, the
 * stack from settings' catalog, the tag chips and the money headline from `ProjectMetrics`. Money fields
 * are `null` without `canSeeFinancials` (C13); a project without a metrics row reads `"0.00"`.
 */
export class ProjectViews {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly projects: ProjectRepository,
    private readonly technologies: ProjectTechnologyCatalogPort,
    private readonly tags: TagAssignments,
    private readonly billing: ProjectBillingPort,
  ) {}

  async rows(actor: CurrentUser, records: readonly ProjectRecord[]): Promise<ProjectListRowView[]> {
    if (records.length === 0) return [];
    const canSeeFinancials = this.authorization.canSeeFinancials(actor);
    const [clientRefs, entries, chips, metrics] = await Promise.all([
      this.projects.clientRefs(records.flatMap((r) => r.clients.map((link) => link.clientId))),
      this.technologies.findByIds(records.flatMap((r) => r.technologyIds)),
      this.tags.chipsFor(records.map((r) => ({ entityType: 'PROJECT' as const, entityId: r.id }))),
      canSeeFinancials
        ? this.projects.metricsFor(records.map((r) => r.id))
        : Promise.resolve(new Map<string, ProjectMetricsRow>()),
    ]);
    const refById = new Map<string, EntityRef>(clientRefs.map((ref) => [ref.id, ref]));
    const techById = new Map(entries.map((entry) => [entry.id, entry]));

    return records.map((record) => {
      const clients = record.clients.flatMap((link) => {
        const client = refById.get(link.clientId);
        return client ? [{ client, role: link.role }] : [];
      });
      const stack: TechnologyChipView[] = record.technologyIds
        .flatMap((id) => {
          const entry = techById.get(id);
          return entry
            ? [
                {
                  id: entry.id,
                  name: entry.name,
                  nameEn: entry.nameEn,
                  category: entry.category,
                  iconSlug: entry.iconSlug,
                  color: entry.color,
                },
              ]
            : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
      // `targetKey` of settings: `<entityType>:<entityId>`.
      const tags: TagChipView[] = chips.get(`PROJECT:${record.id}`) ?? [];
      const headline: ProjectFinancialHeadline = canSeeFinancials
        ? (metrics.get(record.id) ?? ZERO)
        : NO_FINANCIALS;
      return {
        id: record.id,
        code: record.code,
        name: record.name,
        clients,
        status: record.status,
        startDate: record.startDate,
        targetEndDate: record.targetEndDate,
        stack,
        tags,
        archivedAt: record.archivedAt,
        ...headline,
      };
    });
  }

  async detail(actor: CurrentUser, record: ProjectRecord): Promise<ProjectDetailView> {
    const [row] = await this.rows(actor, [record]);
    if (!row) throw new Error('unreachable: one record yields one row');
    return {
      ...row,
      summary: record.summary,
      description: record.description,
      endDate: record.endDate,
      links: sortLinks(record.links),
      hasBillingPlan: await this.billing.hasBillingPlan(record.id),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
