import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import { toTagChip, type TagChip } from '../../domain/tag';
import type { TaggableTargetRegistry } from '../taggable-target.registry';
import type { TagAssignments } from '../tag-assignments';

export interface AssignTagsInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly tagIds: readonly string[];
}

/**
 * `POST /tags/assign`: adds tags to one record (already assigned ones are ignored) and returns its chips.
 * Order: resolver for the entity type (`VALIDATION` when unregistered) → `can(update, resolver.resource)`
 * → the record must exist and be live (`NOT_FOUND`) → one unit of work with the rows and one `LINK`
 * entry per tag actually added, carrying the record's `clientId` (none when every tag was already there).
 */
export class AssignTags {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly registry: TaggableTargetRegistry,
    private readonly uow: UnitOfWorkPort,
    private readonly assignments: TagAssignments,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: AssignTagsInput): Promise<TagChip[]> {
    const resolver = this.registry.resolverFor(input.entityType);
    assertCan(this.authorization, actor, 'update', resolver.resource);
    const record = await resolver.resolve(input.entityId);
    if (!record) throw new NotFoundError();
    const target = { entityType: resolver.entityType, entityId: input.entityId };

    return this.uow.run(async () => {
      const { added, all } = await this.assignments.add(target, input.tagIds);
      for (const tag of added) {
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'LINK',
          entityType: target.entityType,
          entityId: target.entityId,
          entityLabel: record.label,
          clientId: record.clientId,
          metadata: { tagId: tag.id, tagName: tag.name },
        });
      }
      return all.map(toTagChip);
    });
  }
}
