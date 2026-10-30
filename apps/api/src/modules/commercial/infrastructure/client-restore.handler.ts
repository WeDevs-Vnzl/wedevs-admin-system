import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { RestoreHandler } from '../../platform/application/ports/restore-handler.port';
import type { RestoreClient } from '../application/use-cases/restore-client.use-case';
import { toClientRef } from '../domain/client';

/** What `commercial` registers so the trash can bring a client back: its own `RestoreClient` use case. */
export class ClientRestoreHandler implements RestoreHandler {
  readonly entityType = 'CLIENT' as const;
  readonly resource = 'client' as const;

  constructor(private readonly restoreClient: RestoreClient) {}

  async restore(user: CurrentUser, entityId: string): Promise<EntityRef> {
    const detail = await this.restoreClient.execute(user, { id: entityId, via: 'trash' });
    return toClientRef(detail.client);
  }
}
