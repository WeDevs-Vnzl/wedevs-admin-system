import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import { toContactRef } from '../../domain/contact';
import type { ContactRepository } from '../ports/contact.repository.port';
import { SEARCH_LIMIT_MAX } from './search-clients.use-case';

/**
 * `GET /contacts/search?q&clientId&limit`: live contacts of live clients matching `q`, optionally of one
 * client, as `EntityRef`s (primary first, then by name), at most `limit` (default and cap 20).
 */
export class SearchContacts {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly contacts: ContactRepository,
  ) {}

  async execute(
    actor: CurrentUser,
    input: {
      readonly q?: string | undefined;
      readonly clientId?: string | undefined;
      readonly limit?: number | undefined;
    },
  ): Promise<EntityRef[]> {
    assertCan(this.authorization, actor, 'read', 'contact');
    const limit = Math.min(Math.max(input.limit ?? SEARCH_LIMIT_MAX, 1), SEARCH_LIMIT_MAX);
    const q = input.q?.trim();
    const found = await this.contacts.search(q ? q : undefined, input.clientId, limit);
    return found.map(toContactRef);
  }
}
