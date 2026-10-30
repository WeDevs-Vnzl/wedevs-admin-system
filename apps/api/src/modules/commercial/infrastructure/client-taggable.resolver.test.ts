import { describe, expect, it } from 'vitest';
import { createWorld, nth } from '../../../../test/commercial/clients/world';
import { ClientTaggableResolver } from './client-taggable.resolver';
import { ContactTaggableResolver } from './contact-taggable.resolver';

describe('taggable resolvers', () => {
  it('resolve a live client and a live contact with their label and client', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient({ tradeName: 'Kairos Studio' }, 1);
    const clients = new ClientTaggableResolver(w.clients);
    const contactResolver = new ContactTaggableResolver(w.contacts);

    expect([clients.entityType, clients.resource]).toEqual(['CLIENT', 'client']);
    expect([contactResolver.entityType, contactResolver.resource]).toEqual(['CONTACT', 'contact']);
    expect(await clients.resolve(client.id)).toEqual({
      label: 'Kairos Studio',
      clientId: client.id,
    });
    const contact = nth(contacts, 0);
    expect(await contactResolver.resolve(contact.id)).toEqual({
      label: contact.fullName,
      clientId: client.id,
    });
  });

  it('answer null for unknown and archived records', async () => {
    const w = createWorld();
    const archived = w.seedClient({ deletedAt: new Date() }, 0).client;
    const live = w.seedClient({}, 1);
    w.contacts.seed({ ...nth(live.contacts, 0), id: 'con_gone', deletedAt: new Date() });
    const clients = new ClientTaggableResolver(w.clients);
    const contacts = new ContactTaggableResolver(w.contacts);
    expect(await clients.resolve('cli_nope')).toBeNull();
    expect(await clients.resolve(archived.id)).toBeNull();
    expect(await contacts.resolve('con_nope')).toBeNull();
    expect(await contacts.resolve('con_gone')).toBeNull();
  });
});
