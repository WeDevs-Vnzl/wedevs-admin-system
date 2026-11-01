import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import {
  normalizeProjectClients,
  type ProjectClientInput,
  type ProjectDetailView,
} from '../../domain/project';
import type { ProjectRepository } from '../ports/project.repository.port';
import { clientLinkEntries } from './project-link-entries';
import { loadLiveProject, reloadProject, type ProjectReferences } from './project-references';
import type { ProjectSync } from './project-sync';
import type { ProjectViews } from './project-views';

export interface SetProjectClientsInput {
  readonly id: string;
  readonly clients: readonly ProjectClientInput[];
}

/**
 * `PUT /projects/{id}/clients` (HU-05 CA1, CA2). Replaces the client set (at least one, all live; the
 * ones already linked keep their link). When something changed: the link entries (`LINK`, `UNLINK`, role
 * `UPDATE`), the search entry (client names) and the `projectCount` recount of the old and new clients,
 * all in the same unit of work. An unchanged set writes nothing.
 */
export class SetProjectClients {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly references: ProjectReferences,
    private readonly sync: ProjectSync,
    private readonly views: ProjectViews,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: SetProjectClientsInput): Promise<ProjectDetailView> {
    assertCan(this.authorization, actor, 'update', 'project');

    await this.uow.run(async () => {
      const before = await loadLiveProject(this.projects, input.id);
      const clients = normalizeProjectClients(input.clients, this.clock.now(), before.clients);
      await this.references.assertClients(
        clients.map((link) => link.clientId),
        before.clients.map((link) => link.clientId),
      );
      const entries = await clientLinkEntries(this.projects, before.clients, clients);
      if (entries.length === 0) return;

      await this.projects.replaceClients(before.id, clients);
      await this.projects.touch(before.id, actor.userId);
      const after = await reloadProject(this.projects, before.id);
      for (const entry of entries) await this.sync.log(actor, entry.action, after, entry);
      await this.sync.reindex(after);
      await this.sync.recount([
        ...before.clients.map((link) => link.clientId),
        ...after.clients.map((link) => link.clientId),
      ]);
    });

    return this.views.detail(actor, await reloadProject(this.projects, input.id));
  }
}
