import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import {
  normalizeLinkInputs,
  sortLinks,
  upsertLinks,
  type ProjectLinkInput,
  type ProjectLinkRecord,
} from '../../domain/project-link';
import type { ProjectRepository } from '../ports/project.repository.port';
import { loadLiveProject, reloadProject } from './project-references';
import type { ProjectSync } from './project-sync';

export interface UpsertProjectLinksInput {
  readonly id: string;
  readonly links: readonly ProjectLinkInput[];
}

/**
 * `PUT /projects/{id}/links` (HU-07 CA1, CA3). Creates the links without id and updates the ones with id;
 * removes none. A bad URL is `VALIDATION` on `links.<i>.url`; an unknown link id is a bare `NOT_FOUND`.
 * Logs one `UPDATE` ("links changed" + the link count).
 */
export class UpsertProjectLinks {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly sync: ProjectSync,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: UpsertProjectLinksInput): Promise<ProjectLinkRecord[]> {
    assertCan(this.authorization, actor, 'update', 'project');
    const inputs = normalizeLinkInputs(input.links);

    return this.uow.run(async () => {
      const project = await loadLiveProject(this.projects, input.id);
      const links = upsertLinks(project.links, inputs, () => this.ids.next());
      await this.projects.replaceLinks(project.id, links);
      await this.projects.touch(project.id, actor.userId);
      await this.sync.log(actor, 'UPDATE', await reloadProject(this.projects, project.id), {
        changes: { links: 'changed' },
        metadata: { linkCount: links.length },
      });
      return sortLinks(links);
    });
  }
}
