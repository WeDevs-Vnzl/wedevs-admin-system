import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { ProjectDetailView } from '../../domain/project';
import type { ProjectRepository } from '../ports/project.repository.port';
import type { ProjectViews } from './project-views';

/**
 * `GET /projects/{id}`. An archived project is readable only by the trash roles (contract choice 2,
 * C19); for everyone else it is `NOT_FOUND`, like an unknown id. The money headline comes from
 * `ProjectMetrics` and is `null` without `canSeeFinancials`.
 */
export class GetProject {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly projects: ProjectRepository,
    private readonly views: ProjectViews,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<ProjectDetailView> {
    assertCan(this.authorization, actor, 'read', 'project');
    const record = await this.projects.findById(id);
    if (!record) throw new NotFoundError();
    if (record.archivedAt !== null && !this.authorization.can(actor, 'restore', 'trash')) {
      throw new NotFoundError();
    }
    return this.views.detail(actor, record);
  }
}
