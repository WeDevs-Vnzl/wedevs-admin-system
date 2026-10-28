import type { ActorType } from '../domain/enums';
import type { CurrentUser } from './current-user';

/**
 * Actor of an activity entry. `userId` is null for `SYSTEM` and `PUBLIC` actors.
 */
export interface Actor {
  readonly actorType: ActorType;
  readonly userId: string | null;
}

/** The `USER` actor of an authenticated caller. */
export function actorOf(user: CurrentUser): Actor {
  return { actorType: 'USER', userId: user.userId };
}
