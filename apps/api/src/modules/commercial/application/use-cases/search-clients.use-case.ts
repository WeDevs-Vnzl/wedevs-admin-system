import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import { toClientRef } from '../../domain/client';
import type { ClientRepository } from '../ports/client.repository.port';

/** Typeahead cap (contract choice 7). */
export const SEARCH_LIMIT_MAX = 20;

/** `GET /clients/search?q&limit`: live clients matching `q` as `EntityRef`s, at most `limit` (default and cap 20). */
export class SearchClients {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly clients: ClientRepository,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly q?: string | undefined; readonly limit?: number | undefined },
  ): Promise<EntityRef[]> {
    assertCan(this.authorization, actor, 'read', 'client');
    const limit = Math.min(Math.max(input.limit ?? SEARCH_LIMIT_MAX, 1), SEARCH_LIMIT_MAX);
    const q = input.q?.trim();
    return (await this.clients.search(q ? q : undefined, limit)).map(toClientRef);
  }
}
