import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { RestoreHandler } from '../../platform/application/ports/restore-handler.port';
import type { RestoreContact } from '../application/use-cases/restore-contact.use-case';
import { toContactRef } from '../domain/contact';

/** What `commercial` registers so the trash can bring a contact back: its own `RestoreContact` use case. */
export class ContactRestoreHandler implements RestoreHandler {
  readonly entityType = 'CONTACT' as const;
  readonly resource = 'contact' as const;

  constructor(private readonly restoreContact: RestoreContact) {}

  async restore(user: CurrentUser, entityId: string): Promise<EntityRef> {
    const view = await this.restoreContact.execute(user, { id: entityId });
    return toContactRef(view.contact);
  }
}
