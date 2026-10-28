import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { DateOnly } from '../../../../shared/domain/business-date';
import type { SortSpec } from '../../../../shared/domain/list-query';
import { paginated, type Paginated } from '../../../../shared/domain/pagination';
import type { TrashableEntityType } from '../ports/restore-handler.port';
import type { TrashReadPort, TrashRow } from '../ports/trash-read.port';
import type { RestoreHandlerRegistry } from '../restore-handler.registry';

export interface ListTrashInput {
  readonly page: number;
  readonly pageSize: number;
  readonly sort: SortSpec;
  readonly q?: string;
  readonly entityType?: readonly TrashableEntityType[];
  readonly deletedById?: readonly string[];
  readonly deletedFrom?: DateOnly;
  readonly deletedTo?: DateOnly;
}

/**
 * `GET /trash` (PRD §7.7, HU-28). The types listed are those a context registered a restore handler for,
 * that the actor may `read`, and that the `entityType` filter keeps; the rest of the trash stays invisible.
 */
export class ListTrash {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly registry: RestoreHandlerRegistry,
    private readonly trash: TrashReadPort,
  ) {}

  async execute(actor: CurrentUser, input: ListTrashInput): Promise<Paginated<TrashRow>> {
    assertCan(this.authorization, actor, 'read', 'trash');
    const entityTypes = this.registry
      .all()
      .filter((handler) => this.authorization.can(actor, 'read', handler.resource))
      .map((handler) => handler.entityType)
      .filter((type) => !input.entityType || input.entityType.includes(type));
    if (entityTypes.length === 0) return paginated([], 0, input);
    return this.trash.list({
      entityTypes,
      sort: input.sort,
      page: input.page,
      pageSize: input.pageSize,
      ...(input.q !== undefined ? { q: input.q } : {}),
      ...(input.deletedById !== undefined ? { deletedById: input.deletedById } : {}),
      ...(input.deletedFrom !== undefined ? { deletedFrom: input.deletedFrom } : {}),
      ...(input.deletedTo !== undefined ? { deletedTo: input.deletedTo } : {}),
    });
  }
}
