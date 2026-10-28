import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { actorOf } from '../../../../shared/application/actor';
import { IntegrityLockedError, NotFoundError } from '../../../../shared/domain/domain-error';
import { TECHNOLOGY_IN_USE_KEY } from '../../domain/technology';
import type { TechnologyRepository } from '../ports/technology.repository.port';
import type { TechnologyUsagePort } from '../ports/technology-usage.port';

/**
 * `DELETE /technologies/{id}` (settings grant, hard delete: the catalog is never soft-deleted, C19).
 * Order: `can(delete, settings)` → one Serializable unit of work: load (`NOT_FOUND`), a technology used
 * by a live project is locked (`INTEGRITY_LOCK`, HU-06 CA3), otherwise the technology is removed from the
 * stacks of archived projects, the row is deleted and `SETTINGS_CHANGE` is logged.
 *
 * Restoring a project later does not bring a technology deleted meanwhile back: its stack keeps no
 * reference to it (carried H1 item, documented in the restore flow of commercial).
 */
export class DeleteTechnology {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly technologies: TechnologyRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly usage: TechnologyUsagePort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly id: string },
  ): Promise<{ readonly id: string }> {
    assertCan(this.authorization, actor, 'delete', 'settings');

    return this.uow.run(
      async () => {
        const row = await this.technologies.findById(input.id);
        if (!row) throw new NotFoundError();
        if ((await this.usage.countLiveProjects(row.id)) > 0) {
          throw new IntegrityLockedError({ message: TECHNOLOGY_IN_USE_KEY });
        }

        await this.usage.detachFromArchivedProjects(row.id);
        await this.technologies.delete(row.id);
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'SETTINGS_CHANGE',
          entityType: 'SETTING',
          entityId: row.id,
          entityLabel: row.name,
          changes: { technology: [row.name, null] },
        });
        return { id: row.id };
      },
      { isolation: 'Serializable' },
    );
  }
}
