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

export interface UnassignTagInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly tagId: string;
}

/**
 * `POST /tags/unassign`: removes one tag from one record and returns the remaining chips. Same checks as
 * `AssignTags`. One `UNLINK` entry when the tag was assigned; none (and no error) otherwise.
 */
export class UnassignTag {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly registry: TaggableTargetRegistry,
    private readonly uow: UnitOfWorkPort,
    private readonly assignments: TagAssignments,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: UnassignTagInput): Promise<TagChip[]> {
    const resolver = this.registry.resolverFor(input.entityType);
    assertCan(this.authorization, actor, 'update', resolver.resource);
    const record = await resolver.resolve(input.entityId);
    if (!record) throw new NotFoundError();
    const target = { entityType: resolver.entityType, entityId: input.entityId };

    return this.uow.run(async () => {
      const { removed, all } = await this.assignments.remove(target, input.tagId);
      if (removed) {
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'UNLINK',
          entityType: target.entityType,
          entityId: target.entityId,
          entityLabel: record.label,
          clientId: record.clientId,
          metadata: { tagId: removed.id, tagName: removed.name },
        });
      }
      return all.map(toTagChip);
    });
  }
}
