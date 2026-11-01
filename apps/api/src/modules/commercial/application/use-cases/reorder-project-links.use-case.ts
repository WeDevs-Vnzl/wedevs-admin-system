import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import type { ProjectLinkGroup } from '../../../../shared/domain/enums';
import { reorderLinks, sortLinks, type ProjectLinkRecord } from '../../domain/project-link';
import type { ProjectRepository } from '../ports/project.repository.port';
import { loadLiveProject, reloadProject } from './project-references';
import type { ProjectSync } from './project-sync';

export interface ReorderProjectLinksInput {
  readonly id: string;
  readonly group: ProjectLinkGroup;
  readonly orderedLinkIds: readonly string[];
}

/**
 * `POST /projects/{id}/links/reorder` (HU-07 CA2). `orderedLinkIds` must be exactly the ids of the group
 * (`VALIDATION` on `orderedLinkIds` otherwise); the new order persists and the other groups are left
 * alone. Logs one `UPDATE` ("links changed" + the group).
 */
export class ReorderProjectLinks {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly sync: ProjectSync,
  ) {}

  async execute(actor: CurrentUser, input: ReorderProjectLinksInput): Promise<ProjectLinkRecord[]> {
    assertCan(this.authorization, actor, 'update', 'project');

    return this.uow.run(async () => {
      const project = await loadLiveProject(this.projects, input.id);
      const links = reorderLinks(project.links, input.group, input.orderedLinkIds);
      await this.projects.replaceLinks(project.id, links);
      await this.projects.touch(project.id, actor.userId);
      await this.sync.log(actor, 'UPDATE', await reloadProject(this.projects, project.id), {
        changes: { links: 'changed' },
        metadata: { group: input.group },
      });
      return sortLinks(links);
    });
  }
}
