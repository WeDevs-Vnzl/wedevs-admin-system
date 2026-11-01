import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { ProjectRepository } from '../ports/project.repository.port';
import { reloadProject } from './project-references';
import type { ProjectSync } from './project-sync';

export interface RestoredProject {
  readonly entity: EntityRef;
  readonly restoredAt: Date;
}

/**
 * `POST /projects/{id}/restore` and the trash handler of `PROJECT` (HU-28 CA2). Order:
 * `can(restore, project)` → one unit of work: the project must be archived (`NOT_FOUND` otherwise),
 * clear `deletedAt`, `RESTORE` entry, search entry back, `projectCount` recount of its clients. A
 * technology deleted while the project was archived is not restored: the stack link was dropped by the
 * catalog delete (carried item, documented).
 */
export class RestoreProject {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly sync: ProjectSync,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<RestoredProject> {
    assertCan(this.authorization, actor, 'restore', 'project');

    return this.uow.run(async () => {
      const archived = await this.projects.findByIdForUpdate(id);
      if (!archived || archived.archivedAt === null) throw new NotFoundError();
      await this.projects.lockClients(archived.clients.map((link) => link.clientId));

      await this.projects.setArchived([id], null, null);
      const restored = await reloadProject(this.projects, id);
      await this.sync.log(actor, 'RESTORE', restored, { metadata: { code: restored.code } });
      await this.sync.reindex(restored);
      await this.sync.recount(restored.clients.map((link) => link.clientId));
      return {
        entity: { type: 'PROJECT', id: restored.id, code: restored.code, label: restored.name },
        restoredAt: this.clock.now(),
      };
    });
  }
}
