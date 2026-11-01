import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import type { ClientKind, ClientStatus } from '../../../../shared/domain/enums';
import type { ListQuery, SortSpec } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import { CLIENT_MONEY_SORT_FIELDS, type ClientListRow } from '../../domain/client';
import { FIELD_KEYS } from '../../domain/client-fields';
import type { ClientListQuery, ClientRepository } from '../ports/client.repository.port';
import { chipsByTarget, clientTarget } from './client-support';

const DEFAULT_SORT: SortSpec = { field: 'code', direction: 'asc' };

const values = (raw: string | readonly string[] | undefined): string[] | undefined =>
  raw === undefined ? undefined : Array.isArray(raw) ? [...raw] : [raw as string];

/** Maps the query-string filters of the list (already whitelisted by the DTO) to the repository query. */
export function clientListQueryOf(
  query: ListQuery,
  archived: ListQuery['archived'],
): ClientListQuery {
  const status = values(query.filters.status) as ClientStatus[] | undefined;
  const kind = values(query.filters.kind) as ClientKind[] | undefined;
  const country = values(query.filters.country);
  const tagIds = values(query.filters.tagId);
  const createdFrom = values(query.filters.createdFrom)?.[0];
  const createdTo = values(query.filters.createdTo)?.[0];
  const overdue = values(query.filters.hasOverdue)?.[0];
  return {
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort ?? DEFAULT_SORT,
    archived,
    ...(query.q !== undefined ? { q: query.q } : {}),
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(country ? { country } : {}),
    ...(tagIds ? { tagIds } : {}),
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
    ...(overdue !== undefined ? { hasOverdue: overdue === 'true' } : {}),
  };
}

/**
 * `GET /clients` (HU-03, contract choices 2-3). `can(read, client)` first. `archived=only|include` is
 * honoured only for the trash roles; for anyone else it is `exclude`. Without `canSeeFinancials`, a money
 * sort key or the `hasOverdue` filter is a 422 (`validation.sort.invalid` /
 * `fieldErrors.hasOverdue = ["validation.invalidOption"]`) so the order never leaks amounts, and the money
 * fields of every row are `null` (C13). `projectCount`, `lastActivityAt` and the money columns come from
 * `ClientMetrics` (`0` / `null` / `"0.00"` while the row is absent).
 */
export class ListClients {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly clients: ClientRepository,
    private readonly assignments: TagAssignments,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<ClientListRow>> {
    assertCan(this.authorization, actor, 'read', 'client');
    const seesMoney = this.authorization.canSeeFinancials(actor);
    const sort = query.sort ?? DEFAULT_SORT;
    if (!seesMoney) {
      if (CLIENT_MONEY_SORT_FIELDS.includes(sort.field)) {
        throw new ValidationFailedError({ fieldErrors: { sort: ['validation.sort.invalid'] } });
      }
      if (query.filters.hasOverdue !== undefined) {
        throw new ValidationFailedError({
          fieldErrors: { hasOverdue: [FIELD_KEYS.invalidOption] },
        });
      }
    }
    const archived = this.authorization.can(actor, 'restore', 'trash') ? query.archived : 'exclude';

    const page = await this.clients.list(clientListQueryOf(query, archived));
    const chips = await chipsByTarget(
      this.assignments,
      page.items.map((entry) => clientTarget(entry.client.id)),
    );
    return {
      ...page,
      items: page.items.map((entry, index) => ({
        client: entry.client,
        projectCount: entry.projectCount,
        lastActivityAt: entry.lastActivityAt,
        totalInvoicedUsd: seesMoney ? entry.totalInvoicedUsd : null,
        receivableUsd: seesMoney ? entry.receivableUsd : null,
        tags: [...(chips[index] ?? [])],
      })),
    };
  }
}
