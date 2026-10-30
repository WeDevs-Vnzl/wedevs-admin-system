import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import type { ContactView } from '../../domain/contact';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';
import { chipsByTarget, contactTarget, toContactViews } from './client-support';

/**
 * `GET /clients/{id}/contacts` (HU-04, primary first by default). `can(read, contact)` → the client must
 * exist (`NOT_FOUND`; an archived one only for the trash roles). `archived=only|include` is honoured only
 * for the trash roles (C19).
 */
export class ListContacts {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly clients: ClientRepository,
    private readonly contacts: ContactRepository,
    private readonly assignments: TagAssignments,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly clientId: string; readonly query: ListQuery },
  ): Promise<Paginated<ContactView>> {
    assertCan(this.authorization, actor, 'read', 'contact');
    const seesArchived = this.authorization.can(actor, 'restore', 'trash');
    const client = await this.clients.findById(input.clientId);
    if (!client || (client.deletedAt && !seesArchived)) throw new NotFoundError();

    const page = await this.contacts.list(client.id, {
      ...input.query,
      archived: seesArchived ? input.query.archived : 'exclude',
    });
    const chips = await chipsByTarget(
      this.assignments,
      page.items.map((contact) => contactTarget(contact.id)),
    );
    return { ...page, items: toContactViews(page.items, chips) };
  }
}
