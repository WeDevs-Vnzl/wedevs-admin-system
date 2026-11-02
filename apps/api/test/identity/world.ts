import { MatrixAuthorization } from '../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../src/shared/application/current-user';
import type { UserRecord } from '../../src/modules/identity/domain/user';
import { FixedClock } from '../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../support/fakes/sequential-id-generator';
import { InMemoryLoginActivityRepository } from './fakes/in-memory-login-activity.repository';
import { InMemoryUserPreferenceRepository } from './fakes/in-memory-user-preference.repository';
import { InMemoryUserRepository, makeUser } from './fakes/in-memory-user.repository';
import { FakeIdentityProvider } from './fakes/fake-identity-provider';
import { RecordingDiagnostics } from './fakes/recording-diagnostics';

/** All the in-memory ports of the identity context, wired together. */
export function createWorld() {
  const clock = new FixedClock();
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  return {
    clock,
    uow,
    activity,
    ids: new SequentialIdGenerator('usr'),
    authorization: new MatrixAuthorization(),
    users: new InMemoryUserRepository(),
    preferences: new InMemoryUserPreferenceRepository(),
    logins: new InMemoryLoginActivityRepository(activity),
    identity: new FakeIdentityProvider(),
    diagnostics: new RecordingDiagnostics(),
  };
}
export type World = ReturnType<typeof createWorld>;

export function currentUserOf(user: UserRecord): CurrentUser {
  return {
    userId: user.id,
    clerkId: user.clerkId,
    role: user.role,
    email: user.email,
    name: user.name,
  };
}

/** Seeds one user of `role` and returns both the row and its `CurrentUser`. */
export function seedUser(
  world: World,
  role: UserRecord['role'],
  overrides: Partial<UserRecord> = {},
) {
  const row = makeUser({
    id: `usr_${role.toLowerCase()}`,
    clerkId: `clerk_${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@example.com`,
    name: role,
    role,
    ...overrides,
  });
  world.users.seed(row);
  return { row, actor: currentUserOf(row) };
}
