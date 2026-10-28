import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { actorOf } from '../../../../shared/application/actor';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import {
  technologyChanges,
  toTechnologyView,
  type TechnologyRecord,
  type TechnologyView,
} from '../../domain/technology';
import type { TechnologyRepository } from '../ports/technology.repository.port';
import type { TechnologyUsagePort } from '../ports/technology-usage.port';

/**
 * `POST /technologies/{id}/active` (settings grant). Deactivation is the way to retire a technology that
 * projects use (HU-06 CA3). Setting the value it already has writes and logs nothing.
 */
export class SetTechnologyActive {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly technologies: TechnologyRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly usage: TechnologyUsagePort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly id: string; readonly active: boolean },
  ): Promise<TechnologyView> {
    assertCan(this.authorization, actor, 'update', 'settings');

    const record = await this.uow.run(async () => {
      const before = await this.technologies.findById(input.id);
      if (!before) throw new NotFoundError();
      const after: TechnologyRecord = { ...before, active: input.active };
      const changes = technologyChanges(before, after);
      if (changes === null) return before;

      await this.technologies.update(after);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: after.id,
        entityLabel: after.name,
        changes,
      });
      return after;
    });

    return toTechnologyView(record, await this.usage.countLiveProjects(record.id));
  }
}
