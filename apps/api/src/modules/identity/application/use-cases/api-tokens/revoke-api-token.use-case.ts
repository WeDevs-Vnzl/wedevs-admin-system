import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { ApiTokenRepository } from '../../ports/api-token.repository.port';
import { toApiTokenOutput, type ApiTokenOutput } from './api-token-support';

export interface RevokeApiTokenInput {
  readonly id: string;
}

/**
 * Revokes one of the caller's tokens. A token that is not the caller's answers not found, as an unknown one
 * does. Revoking twice is a no-op that keeps the first `revokedAt` and writes no second activity entry.
 */
export class RevokeApiToken {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly tokens: ApiTokenRepository,
    private readonly activity: ActivityLogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: RevokeApiTokenInput): Promise<ApiTokenOutput> {
    return this.uow.run(async () => {
      const current = await this.tokens.findOwned(input.id, actor.userId);
      if (!current) throw new NotFoundError();
      if (current.revokedAt) return toApiTokenOutput(current);
      const now = this.clock.now();
      await this.tokens.revoke(current.id, now);
      await this.activity.record({
        actor: actorOf(actor),
        action: 'UPDATE',
        entityType: 'API_TOKEN',
        entityId: current.id,
        entityLabel: current.name,
        changes: { revokedAt: [null, now.toISOString()] },
        metadata: { prefix: current.prefix },
      });
      return toApiTokenOutput({ ...current, revokedAt: now });
    });
  }
}
