import type { PermissionResource } from '../../src/shared/application/authorization';
import type { CurrentUser } from '../../src/shared/application/current-user';
import type { EntityRef } from '../../src/shared/domain/entity-ref';
import { ConflictError, NotFoundError } from '../../src/shared/domain/domain-error';
import { paginated, type Paginated } from '../../src/shared/domain/pagination';
import type {
  RestoreHandler,
  TrashableEntityType,
} from '../../src/modules/platform/application/ports/restore-handler.port';
import type {
  TrashReadPort,
  TrashReadQuery,
  TrashRow,
} from '../../src/modules/platform/application/ports/trash-read.port';
import { RestoreHandlerRegistry } from '../../src/modules/platform/application/restore-handler.registry';
import { ListTrash } from '../../src/modules/platform/application/use-cases/list-trash.use-case';
import { RestoreFromTrash } from '../../src/modules/platform/application/use-cases/restore-from-trash.use-case';
import { FakeAuthorization } from '../support/fakes/fake-authorization';
import { FixedClock } from '../support/fakes/fixed-clock';

export const userOf = (role: CurrentUser['role']): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `clerk_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});
export const owner = userOf('OWNER');
export const admin = userOf('ADMIN');
export const member = userOf('MEMBER');
export const viewer = userOf('VIEWER');

/** Stand-in for the matrix rows this package relies on: Owner and Admin read and restore everything. */
export const trashPolicy = new FakeAuthorization({
  policy: (user) => user.role === 'OWNER' || user.role === 'ADMIN',
});

/** Records the query it received and answers a preset page. */
export class FakeTrashRead implements TrashReadPort {
  readonly queries: TrashReadQuery[] = [];
  rows: TrashRow[] = [];

  list(query: TrashReadQuery): Promise<Paginated<TrashRow>> {
    this.queries.push(query);
    return Promise.resolve(paginated(this.rows, this.rows.length, query));
  }
}

/** A handler that restores an in-memory set of ids, like a context's restore use case would. */
export class FakeRestoreHandler implements RestoreHandler {
  readonly calls: { user: CurrentUser; entityId: string }[] = [];
  readonly archived = new Set<string>();
  conflictWith: EntityRef | null = null;

  constructor(
    readonly entityType: TrashableEntityType,
    readonly resource: PermissionResource,
  ) {}

  restore(user: CurrentUser, entityId: string): Promise<EntityRef> {
    this.calls.push({ user, entityId });
    if (!this.archived.has(entityId)) return Promise.reject(new NotFoundError());
    if (this.conflictWith) {
      return Promise.reject(
        new ConflictError({ message: 'trash.errors.taxIdTaken', entity: this.conflictWith }),
      );
    }
    this.archived.delete(entityId);
    return Promise.resolve({ type: this.entityType, id: entityId, label: `Label ${entityId}` });
  }
}

export function buildTrashHarness() {
  const registry = new RestoreHandlerRegistry();
  const read = new FakeTrashRead();
  const clock = new FixedClock('2026-10-25T15:00:00.000Z');
  return {
    registry,
    read,
    clock,
    listTrash: new ListTrash(trashPolicy, registry, read),
    restoreFromTrash: new RestoreFromTrash(trashPolicy, registry, clock),
  };
}
