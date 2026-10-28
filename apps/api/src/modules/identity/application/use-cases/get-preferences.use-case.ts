import type { CurrentUser } from '../../../../shared/application/current-user';
import { UnauthenticatedError } from '../../../../shared/domain/domain-error';
import { buildPreferences, type UserPreferences } from '../../domain/preference';
import type { UserPreferenceRepository } from '../ports/user-preference.repository.port';
import type { UserRepository } from '../ports/user.repository.port';

/** Loads the effective preferences of the user. Shared by the three preference use cases. */
export async function loadPreferences(
  users: UserRepository,
  preferences: UserPreferenceRepository,
  userId: string,
): Promise<UserPreferences> {
  const user = await users.findActiveById(userId);
  if (!user) throw new UnauthenticatedError();
  const rows = await preferences.listByUser(userId);
  return buildPreferences(user, rows);
}

/**
 * `GET /me/preferences` (DT-71 `'authenticated'` scope: own rows only, so no matrix grant applies). Keys
 * never stored fall back to the user row, then to the defaults; stored values are re-validated on read.
 */
export class GetPreferences {
  constructor(
    private readonly users: UserRepository,
    private readonly preferences: UserPreferenceRepository,
  ) {}

  execute(actor: CurrentUser): Promise<UserPreferences> {
    return loadPreferences(this.users, this.preferences, actor.userId);
  }
}
