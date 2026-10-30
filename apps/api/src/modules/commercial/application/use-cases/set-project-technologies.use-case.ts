import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import type { ProjectDetailView } from '../../domain/project';
import { projectChanges, sortedNames } from '../../domain/project';
import type { ProjectRepository } from '../ports/project.repository.port';
import { loadLiveProject, reloadProject, type ProjectReferences } from './project-references';
import type { ProjectSync } from './project-sync';
import type { ProjectViews } from './project-views';

export interface SetProjectTechnologiesInput {
  readonly id: string;
  readonly technologyIds: readonly string[];
}

/**
 * `PUT /projects/{id}/technologies` (HU-06 CA1). Replaces the stack with catalog technologies: unknown
 * ids and inactive ones the project does not already carry are `VALIDATION` on `technologyIds`. Logs
 * one `UPDATE` with the sorted names before and after; an unchanged stack writes nothing.
 */
export class SetProjectTechnologies {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly references: ProjectReferences,
    private readonly sync: ProjectSync,
    private readonly views: ProjectViews,
  ) {}

  async execute(
    actor: CurrentUser,
    input: SetProjectTechnologiesInput,
  ): Promise<ProjectDetailView> {
    assertCan(this.authorization, actor, 'update', 'project');

    await this.uow.run(async () => {
      const before = await loadLiveProject(this.projects, input.id);
      await this.references.assertTechnologies(input.technologyIds, before.technologyIds);
      const beforeNames = sortedNames(await this.references.technologyNames(before.technologyIds));
      const afterNames = sortedNames(await this.references.technologyNames(input.technologyIds));
      const changes = projectChanges(
        { technologyIds: beforeNames },
        { technologyIds: afterNames },
        ['technologyIds'],
      );
      if (!changes) return;

      await this.projects.replaceTechnologies(before.id, input.technologyIds);
      await this.projects.touch(before.id, actor.userId);
      await this.sync.log(actor, 'UPDATE', await reloadProject(this.projects, before.id), {
        changes,
      });
    });

    return this.views.detail(actor, await reloadProject(this.projects, input.id));
  }
}
