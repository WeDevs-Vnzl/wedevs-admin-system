import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type {
  RestoreHandler,
  TrashableEntityType,
} from '../../platform/application/ports/restore-handler.port';
import type { RestoreProject } from '../application/use-cases/restore-project.use-case';

/** The trash's handler for `PROJECT`: delegates to commercial's own restore use case. */
export class ProjectRestoreHandler implements RestoreHandler {
  readonly entityType: TrashableEntityType = 'PROJECT';
  readonly resource = 'project' as const;

  constructor(private readonly restoreProject: RestoreProject) {}

  async restore(user: CurrentUser, entityId: string): Promise<EntityRef> {
    return (await this.restoreProject.execute(user, entityId)).entity;
  }
}
