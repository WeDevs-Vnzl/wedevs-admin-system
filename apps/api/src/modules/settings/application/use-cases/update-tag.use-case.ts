import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, NotFoundError } from '../../../../shared/domain/domain-error';
import {
  TAG_NAME_TAKEN_KEY,
  assertTagColor,
  normalizeTagName,
  sameTagName,
  tagChanges,
} from '../../domain/tag';
import type { TagRepository } from '../ports/tag.repository.port';
import type { TagOutput } from './list-tags.use-case';

export interface UpdateTagInput {
  readonly id: string;
  readonly name?: string | undefined;
  readonly color?: string | undefined;
}

/**
 * `PATCH /tags/{id}`: rename and/or recolour (`update settings`). A rename keeps the name unique
 * (case-insensitive, its own name excluded). `UPDATE` is logged only when a field really changed.
 */
export class UpdateTag {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly tags: TagRepository,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: UpdateTagInput): Promise<TagOutput> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const name = input.name === undefined ? undefined : normalizeTagName(input.name);
    const color = input.color === undefined ? undefined : assertTagColor(input.color);

    return this.uow.run(async () => {
      const current = await this.tags.find(input.id);
      if (!current) throw new NotFoundError();
      if (name !== undefined) {
        const taken = await this.tags.findByName(name);
        if (taken && taken.id !== current.id && sameTagName(taken.name, name)) {
          throw new ConflictError({
            fieldErrors: { name: [TAG_NAME_TAKEN_KEY] },
            entity: { type: 'TAG', id: taken.id, label: taken.name },
          });
        }
      }
      const next = { ...current, name: name ?? current.name, color: color ?? current.color };
      const changes = tagChanges(current, next);
      if (changes) {
        await this.tags.update(next);
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'UPDATE',
          entityType: 'TAG',
          entityId: next.id,
          entityLabel: next.name,
          changes,
        });
      }
      const withUsage = await this.tags.findWithUsage(next.id);
      if (!withUsage) throw new NotFoundError();
      return withUsage;
    });
  }
}
