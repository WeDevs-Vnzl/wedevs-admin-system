import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import { toUserListRow, type UserListRowOutput } from '../models';
import type { UserRepository } from '../ports/user.repository.port';

/** `GET /users` (HU-02 CA1: Owner only). Active users only; invitations are their own resource. */
export class ListUsers {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly users: UserRepository,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<UserListRowOutput>> {
    assertCan(this.authorization, actor, 'read', 'user');
    const page = await this.users.list(query);
    return { ...page, items: page.items.map(toUserListRow) };
  }
}
