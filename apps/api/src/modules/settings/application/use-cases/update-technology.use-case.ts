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
  assertTechnologyUnique,
  normalizeTechnology,
  technologyChanges,
  toTechnologyView,
  type TechnologyInput,
  type TechnologyRecord,
  type TechnologyView,
} from '../../domain/technology';
import type { TechnologyRepository } from '../ports/technology.repository.port';
import type { TechnologyUsagePort } from '../ports/technology-usage.port';

/**
 * `PATCH /technologies/{id}` (settings grant). The body is the full editable state. Order:
 * `can(update, settings)` → one Serializable unit of work: load (`NOT_FOUND`), normalize, check the name
 * and slug against the other rows, then write and log `SETTINGS_CHANGE` with the changed fields only. No
 * write and no log when nothing changed. The usage count is read after the commit.
 */
export class UpdateTechnology {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly technologies: TechnologyRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly usage: TechnologyUsagePort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: TechnologyInput & { readonly id: string },
  ): Promise<TechnologyView> {
    assertCan(this.authorization, actor, 'update', 'settings');

    const record = await this.uow.run(
      async () => {
        const before = await this.technologies.findById(input.id);
        if (!before) throw new NotFoundError();
        const values = normalizeTechnology(input);
        const others = (await this.technologies.findAll()).filter((row) => row.id !== before.id);
        assertTechnologyUnique(values, others);

        const after: TechnologyRecord = { ...before, ...values };
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
      },
      { isolation: 'Serializable' },
    );

    return toTechnologyView(record, await this.usage.countLiveProjects(record.id));
  }
}
