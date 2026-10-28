import type { CurrentUser } from '../../../../src/shared/application/current-user';
import type { UserRole } from '../../../../src/shared/domain/enums';
import { FakeAuthorization } from '../../../support/fakes/fake-authorization';

/** A signed-in caller with the given role. */
export const actorOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

/** Matrix stand-in for the `settings` grant (PRD §4.3): Owner and Admin create and update, nobody else writes. */
export const settingsPolicy = new FakeAuthorization({
  policy: (user, action, resource) =>
    (action === 'create' || action === 'update') &&
    resource === 'settings' &&
    ['OWNER', 'ADMIN'].includes(user.role),
});
