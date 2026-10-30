import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import {
  assertStatusDates,
  normalizeProjectClients,
  normalizeProjectFields,
  projectChanges,
  projectDiffView,
  type ProjectClientInput,
  type ProjectDetailView,
  type ProjectFieldsInput,
} from '../../domain/project';
import type { ProjectRepository } from '../ports/project.repository.port';
import { clientLinkEntries } from './project-link-entries';
import { loadLiveProject, reloadProject, type ProjectReferences } from './project-references';
import type { ProjectSync } from './project-sync';
import type { ProjectViews } from './project-views';

export interface UpdateProjectInput extends ProjectFieldsInput {
  readonly id: string;
  readonly clients: readonly ProjectClientInput[];
  readonly technologyIds: readonly string[];
  readonly tagIds: readonly string[];
}

const TAG_TARGET = (id: string) => ({ entityType: 'PROJECT' as const, entityId: id });

/**
 * `PATCH /projects/{id}` (HU-05; Member may update). The body is the full editable state. Order:
 * `can(update, project)` → form rules → one unit of work: live project, live clients, stack (an inactive
 * technology the project already carries stays), tags, then one `UPDATE` entry with the field diff
 * (`description` as "changed"; stack and tags as sorted names) plus the client-link entries, the search
 * entry and the `projectCount` recount of the old and new clients. An EN_CURSO project keeps its start
 * date and an ENTREGADO one its end date.
 */
export class UpdateProject {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly references: ProjectReferences,
    private readonly sync: ProjectSync,
    private readonly views: ProjectViews,
    private readonly tags: TagAssignments,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: UpdateProjectInput): Promise<ProjectDetailView> {
    assertCan(this.authorization, actor, 'update', 'project');
    const fields = normalizeProjectFields(input);

    await this.uow.run(async () => {
      const before = await loadLiveProject(this.projects, input.id);
      assertStatusDates(before.status, fields);
      const clients = normalizeProjectClients(input.clients, this.clock.now(), before.clients);
      await this.references.assertClients(
        clients.map((link) => link.clientId),
        before.clients.map((link) => link.clientId),
      );
      await this.references.assertTechnologies(input.technologyIds, before.technologyIds);

      const beforeTags = (await this.tags.chipsFor([TAG_TARGET(before.id)])).get(
        `PROJECT:${before.id}`,
      );
      const beforeView = projectDiffView(
        before,
        await this.references.technologyNames(before.technologyIds),
        (beforeTags ?? []).map((tag) => tag.name),
      );

      await this.projects.updateFields({ ...before, ...fields }, actor.userId);
      await this.projects.replaceClients(before.id, clients);
      await this.projects.replaceTechnologies(before.id, input.technologyIds);
      await this.tags.replace(actor, TAG_TARGET(before.id), input.tagIds);

      const after = await reloadProject(this.projects, before.id);
      const afterTags = (await this.tags.chipsFor([TAG_TARGET(after.id)])).get(
        `PROJECT:${after.id}`,
      );
      const changes = projectChanges(
        beforeView,
        projectDiffView(
          after,
          await this.references.technologyNames(after.technologyIds),
          (afterTags ?? []).map((tag) => tag.name),
        ),
      );
      if (changes) await this.sync.log(actor, 'UPDATE', after, { changes });
      for (const entry of await clientLinkEntries(this.projects, before.clients, after.clients)) {
        await this.sync.log(actor, entry.action, after, entry);
      }
      await this.sync.reindex(after);
      await this.sync.recount([
        ...before.clients.map((link) => link.clientId),
        ...after.clients.map((link) => link.clientId),
      ]);
    });

    return this.views.detail(actor, await reloadProject(this.projects, input.id));
  }
}
