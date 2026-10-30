import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../settings/application/ports/taggable-target.port';
import type { ClientRepository } from '../application/ports/client.repository.port';

/** Tells the tag registry which clients can be tagged and who may tag them (`update` on `client`). */
export class ClientTaggableResolver implements TaggableTargetResolver {
  readonly entityType = 'CLIENT' as const;
  readonly resource = 'client' as const;

  constructor(private readonly clients: ClientRepository) {}

  async resolve(id: string): Promise<TaggableTarget | null> {
    const client = await this.clients.findById(id);
    return client && !client.deletedAt ? { label: client.tradeName, clientId: client.id } : null;
  }
}
