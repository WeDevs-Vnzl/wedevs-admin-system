import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import type { ClientDetailView } from '../../domain/client';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';
import { readClientDetail } from './client-support';

/**
 * `GET /clients/{id}`: the client with its live contacts, primary first, and no `financials` (contract
 * choice 4). An archived client is visible only to the roles that may open the trash; for anyone else it
 * is `NOT_FOUND` (contract choice 2, C19).
 */
export class GetClient {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly clients: ClientRepository,
    private readonly contacts: ContactRepository,
    private readonly assignments: TagAssignments,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<ClientDetailView> {
    assertCan(this.authorization, actor, 'read', 'client');
    const record = await this.clients.findById(input.id);
    if (!record || (record.deletedAt && !this.authorization.can(actor, 'restore', 'trash'))) {
      throw new NotFoundError();
    }
    return readClientDetail(this.contacts, this.assignments, record);
  }
}
