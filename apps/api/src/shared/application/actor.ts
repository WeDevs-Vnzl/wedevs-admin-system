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

/**
 * The actor of the batch's system path: scripts and jobs call their use cases with it and no route.
 * `can()` takes a `CurrentUser`, so a `SYSTEM` use case authorizes by the actor type instead.
 */
export const SYSTEM_ACTOR: Actor = { actorType: 'SYSTEM', userId: null };
