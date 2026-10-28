import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { LoginActivityRepository } from '../ports/login-activity.repository.port';
import type { UserRepository } from '../ports/user.repository.port';

export interface SessionCreatedEvent {
  /** Unique id of the webhook delivery (`svix-id`). */
  readonly svixId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export type RecordLoginOutcome = 'recorded' | 'duplicate' | 'ignored';

/**
 * `session.created` -> one `LOGIN` activity entry (HU-01 CA4). Idempotent per event (Q-BE1-1): the entry
 * carries `metadata.svixId`, and the existence check runs in the same unit of work that writes it.
 * A session of a user the webhook has not created yet is `NOT_FOUND`, so the provider redelivers it once
 * `user.created` has landed.
 */
export class RecordLogin {
  constructor(
    private readonly users: UserRepository,
    private readonly logins: LoginActivityRepository,
    private readonly uow: UnitOfWorkPort,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(event: SessionCreatedEvent): Promise<RecordLoginOutcome> {
    const clerkId = typeof event.data.user_id === 'string' ? event.data.user_id : '';
    if (!clerkId) return 'ignored';
    return this.uow.run(async () => {
      if (await this.logins.existsForEvent(event.svixId)) return 'duplicate';
      const user = await this.users.findActiveByClerkId(clerkId);
      if (!user) throw new NotFoundError();
      await this.activity.record({
        actor: { actorType: 'SYSTEM', userId: null },
        action: 'LOGIN',
        entityType: 'USER',
        entityId: user.id,
        entityLabel: user.name,
        metadata: {
          svixId: event.svixId,
          ...(typeof event.data.id === 'string' ? { sessionId: event.data.id } : {}),
        },
      });
      return 'recorded';
    });
  }
}
