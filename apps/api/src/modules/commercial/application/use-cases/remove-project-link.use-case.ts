import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { removeLink, sortLinks, type ProjectLinkRecord } from '../../domain/project-link';
import type { ProjectRepository } from '../ports/project.repository.port';
import { loadLiveProject, reloadProject } from './project-references';
import type { ProjectSync } from './project-sync';

export interface RemoveProjectLinkInput {
  readonly id: string;
  readonly linkId: string;
}

/**
 * `DELETE /projects/{id}/links/{linkId}` (a link has no soft delete). Closes the gap in its group and
 * logs one `UPDATE` ("links changed" + the removed label and group). An unknown link is a bare
 * `NOT_FOUND` that does not echo the id.
 */
export class RemoveProjectLink {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly sync: ProjectSync,
  ) {}

  async execute(actor: CurrentUser, input: RemoveProjectLinkInput): Promise<ProjectLinkRecord[]> {
    assertCan(this.authorization, actor, 'update', 'project');

    return this.uow.run(async () => {
      const project = await loadLiveProject(this.projects, input.id);
      const { links, removed } = removeLink(project.links, input.linkId);
      await this.projects.replaceLinks(project.id, links);
      await this.projects.touch(project.id, actor.userId);
      await this.sync.log(actor, 'UPDATE', await reloadProject(this.projects, project.id), {
        changes: { links: 'changed' },
        metadata: { removedLabel: removed.label, group: removed.group },
      });
      return sortLinks(links);
    });
  }
}
