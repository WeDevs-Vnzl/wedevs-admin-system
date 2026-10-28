import type { CurrentUser } from '../../../../shared/application/current-user';
import { UnauthenticatedError } from '../../../../shared/domain/domain-error';
import { toUserDetail, type UserDetailOutput } from '../models';
import type { UserRepository } from '../ports/user.repository.port';

/**
 * `GET /me`: the caller's own profile (DT-71 `'authenticated'` scope: a user always reads themself, so no
 * matrix grant applies). Re-read from the DB so a role changed after the guard ran is never stale.
 */
export class GetCurrentUser {
  constructor(private readonly users: UserRepository) {}

  async execute(actor: CurrentUser): Promise<UserDetailOutput> {
    const user = await this.users.findActiveById(actor.userId);
    if (!user) throw new UnauthenticatedError();
    return toUserDetail(user);
  }
}
