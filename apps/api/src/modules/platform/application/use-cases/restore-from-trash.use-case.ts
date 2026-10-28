import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { RestoreHandlerRegistry } from '../restore-handler.registry';

export interface RestoreFromTrashInput {
  readonly entityType: string;
  readonly entityId: string;
}

export interface RestoredRecordOutput {
  readonly entity: EntityRef;
  readonly restoredAt: Date;
}

/**
 * `POST /trash/restore` (HU-28 CA2). Finds the handler the owning context registered, checks `restore` on
 * its resource and delegates: the handler's own use case owns the unit of work, the conflict checks
 * (`CONFLICT` with `entity` propagates), the `RESTORE` activity entry and the reindex.
 */
export class RestoreFromTrash {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly registry: RestoreHandlerRegistry,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: RestoreFromTrashInput): Promise<RestoredRecordOutput> {
    const handler = this.registry.get(input.entityType);
    if (!handler) throw new NotFoundError();
    assertCan(this.authorization, actor, 'restore', handler.resource);
    const entity = await handler.restore(actor, input.entityId);
    return { entity, restoredAt: this.clock.now() };
  }
}
