import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import { toUserDetail, type UserDetailOutput } from '../models';
import type { UserRepository } from '../ports/user.repository.port';

/** `GET /users/{id}`: the Owner reads anyone, every user reads their own detail. */
export class GetUser {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly users: UserRepository,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<UserDetailOutput> {
    if (input.id !== actor.userId) assertCan(this.authorization, actor, 'read', 'user');
    const user = await this.users.findActiveById(input.id);
    if (!user) throw new NotFoundError();
    return toUserDetail(user);
  }
}
