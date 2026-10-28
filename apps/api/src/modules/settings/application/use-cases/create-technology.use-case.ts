import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { actorOf } from '../../../../shared/application/actor';
import {
  assertTechnologyUnique,
  normalizeTechnology,
  toTechnologyView,
  type TechnologyInput,
  type TechnologyView,
} from '../../domain/technology';
import type { TechnologyRepository } from '../ports/technology.repository.port';

/**
 * `POST /technologies` (settings grant). Order: `can(create, settings)` → normalize (slug, bounds, enums)
 * → one Serializable unit of work that checks the name and slug against the catalog, inserts the row and
 * logs `SETTINGS_CHANGE`. A new technology has no project, so its usage is 0.
 */
export class CreateTechnology {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly technologies: TechnologyRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: TechnologyInput): Promise<TechnologyView> {
    assertCan(this.authorization, actor, 'create', 'settings');
    const values = normalizeTechnology(input);

    return this.uow.run(
      async () => {
        assertTechnologyUnique(values, await this.technologies.findAll());
        const record = { id: this.ids.next(), ...values };
        await this.technologies.insert(record);
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'SETTINGS_CHANGE',
          entityType: 'SETTING',
          entityId: record.id,
          entityLabel: record.name,
          changes: { technology: [null, record.name] },
        });
        return toTechnologyView(record, 0);
      },
      { isolation: 'Serializable' },
    );
  }
}
