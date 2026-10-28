import { actorOf } from '../../../../shared/application/actor';
import type {
  PermissionAction,
  PermissionResource,
} from '../../../../shared/application/authorization';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, ForbiddenError } from '../../../../shared/domain/domain-error';
import { TAG_NAME_TAKEN_KEY, assertTagColor, normalizeTagName } from '../../domain/tag';
import type { TagRepository } from '../ports/tag.repository.port';
import type { TagOutput } from './list-tags.use-case';

/**
 * Anyone who may create a settings record, or edit a client or project, or create a note or document,
 * may create a tag (inline from that record). Port of the FE `CREATE_TAG_GRANTS`; any one suffices.
 */
export const CREATE_TAG_GRANTS: readonly {
  readonly action: PermissionAction;
  readonly resource: PermissionResource;
}[] = [
  { action: 'create', resource: 'settings' },
  { action: 'update', resource: 'client' },
  { action: 'update', resource: 'project' },
  { action: 'create', resource: 'note' },
  { action: 'create', resource: 'document' },
];

export interface CreateTagInput {
  readonly name: string;
  readonly color: string;
}

/**
 * `POST /tags`. Order: any of `CREATE_TAG_GRANTS` → validate → one unit of work that checks the name is
 * free (case-insensitive: `CONFLICT` pointing at the holder), inserts and logs `CREATE`.
 */
export class CreateTag {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly tags: TagRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateTagInput): Promise<TagOutput> {
    if (!CREATE_TAG_GRANTS.some((g) => this.authorization.can(actor, g.action, g.resource))) {
      throw new ForbiddenError();
    }
    const name = normalizeTagName(input.name);
    const color = assertTagColor(input.color);

    return this.uow.run(async () => {
      const taken = await this.tags.findByName(name);
      if (taken) {
        throw new ConflictError({
          fieldErrors: { name: [TAG_NAME_TAKEN_KEY] },
          entity: { type: 'TAG', id: taken.id, label: taken.name },
        });
      }
      const tag = { id: this.ids.next(), name, color, createdAt: this.clock.now() };
      await this.tags.insert(tag);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'CREATE',
        entityType: 'TAG',
        entityId: tag.id,
        entityLabel: tag.name,
      });
      return { ...tag, usageCount: 0 };
    });
  }
}
