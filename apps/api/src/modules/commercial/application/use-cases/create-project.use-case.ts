import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { SequencePort } from '../../../../shared/application/ports/sequence.port';
import type { DateOnly } from '../../../../shared/domain/business-date';
import type { ProjectStatus } from '../../../../shared/domain/enums';
import type { RichTextDoc } from '../../../../shared/domain/rich-text';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import {
  assertStatusDates,
  normalizeProjectClients,
  normalizeProjectFields,
  type ProjectClientInput,
  type ProjectDetailView,
  type ProjectRecord,
} from '../../domain/project';
import {
  initialLinks,
  normalizeLinkInputs,
  type ProjectLinkInput,
} from '../../domain/project-link';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { ProjectRepository } from '../ports/project.repository.port';
import { ProjectReferences } from './project-references';
import { ProjectSync } from './project-sync';
import { ProjectViews } from './project-views';
import { clientLinkEntries } from './project-link-entries';

export interface CreateProjectInput {
  readonly name: string;
  readonly summary: string;
  readonly description?: RichTextDoc | null | undefined;
  readonly status: ProjectStatus;
  readonly startDate?: DateOnly | null | undefined;
  readonly targetEndDate?: DateOnly | null | undefined;
  readonly endDate?: DateOnly | null | undefined;
  readonly clients: readonly ProjectClientInput[];
  readonly technologyIds: readonly string[];
  readonly tagIds: readonly string[];
  readonly links: readonly ProjectLinkInput[];
}

/**
 * `POST /projects` (HU-05). Order: `can(create, project)` → form rules → one unit of work: live clients
 * (CA1), active stack (HU-06 CA1), `PRY-####` (sequence), the row with its clients, stack and links,
 * tags, the `CREATE` entry (+ one `LINK` per client), the search entry and the `projectCount` recount of
 * the linked clients (Q-BE2-2). Nothing is written when any step fails.
 */
export class CreateProject {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly references: ProjectReferences,
    private readonly sync: ProjectSync,
    private readonly views: ProjectViews,
    private readonly tags: TagAssignments,
    private readonly sequence: SequencePort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateProjectInput): Promise<ProjectDetailView> {
    assertCan(this.authorization, actor, 'create', 'project');

    const now = this.clock.now();
    const fields = normalizeProjectFields(input);
    assertStatusDates(input.status, fields);
    const clients = normalizeProjectClients(input.clients, now);
    const links = normalizeLinkInputs(input.links);

    const id = await this.uow.run(
      async () => {
        await this.references.assertClients(clients.map((link) => link.clientId));
        await this.references.assertTechnologies(input.technologyIds);

        const record: ProjectRecord = {
          id: this.ids.next(),
          code: await this.sequence.next('PRY'),
          ...fields,
          status: input.status,
          clients,
          technologyIds: [...input.technologyIds],
          links: initialLinks(links, () => this.ids.next()),
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        };
        await this.projects.insert(record, actor.userId);
        await this.tags.replace(
          actor,
          { entityType: 'PROJECT', entityId: record.id },
          input.tagIds,
        );

        await this.sync.log(actor, 'CREATE', record, {
          metadata: { code: record.code, status: record.status },
        });
        for (const entry of await clientLinkEntries(this.projects, [], clients)) {
          await this.sync.log(actor, entry.action, record, entry);
        }
        await this.sync.reindex(record);
        await this.sync.recount(clients.map((link) => link.clientId));
        return record.id;
      },
      { isolation: 'Serializable' },
    );

    const created = await this.projects.findById(id);
    if (!created) throw new NotFoundError();
    return this.views.detail(actor, created);
  }
}
