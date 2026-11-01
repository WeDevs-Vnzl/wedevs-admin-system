import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../settings/application/ports/taggable-target.port';
import type { ContactRepository } from '../application/ports/contact.repository.port';

/** Tells the tag registry which contacts can be tagged and who may tag them (`update` on `contact`). */
export class ContactTaggableResolver implements TaggableTargetResolver {
  readonly entityType = 'CONTACT' as const;
  readonly resource = 'contact' as const;

  constructor(private readonly contacts: ContactRepository) {}

  async resolve(id: string): Promise<TaggableTarget | null> {
    const contact = await this.contacts.findById(id);
    return contact && !contact.deletedAt
      ? { label: contact.fullName, clientId: contact.clientId }
      : null;
  }
}
