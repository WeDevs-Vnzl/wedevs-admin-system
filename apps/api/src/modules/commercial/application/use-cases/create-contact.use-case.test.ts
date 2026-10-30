import { describe, expect, it } from 'vitest';
import { contactInput, createWorld, rejection } from '../../../../../test/commercial/clients/world';

describe('CreateContact', () => {
  it('creates the contact on a live client and logs CREATE on CONTACT with the clientId (HU-04)', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    const view = await w.createContact.execute(w.owner, {
      ...contactInput({ position: 'CTO' }),
      clientId: client.id,
    });
    expect(view.contact).toMatchObject({
      clientId: client.id,
      fullName: 'Ana Pérez',
      position: 'CTO',
      email: 'ana@kairos.example.com',
      phone: null,
      isPrimary: false,
      deletedAt: null,
    });
    expect(view.tags).toEqual([]);
    expect(w.activity.entries).toEqual([
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'CONTACT',
        entityId: view.contact.id,
        entityLabel: 'Ana Pérez',
        clientId: client.id,
        metadata: { clientId: client.id },
      }),
    ]);
  });

  it('writes a search entry per contact (CA3)', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    const { contact } = await w.createContact.execute(w.owner, {
      ...contactInput({ position: 'CTO', phone: '+584121234567' }),
      clientId: client.id,
    });
    expect(w.search.get('CONTACT', contact.id)).toEqual({
      entityType: 'CONTACT',
      entityId: contact.id,
      code: null,
      title: 'Ana Pérez',
      subtitle: 'CTO',
      body: 'ana@kairos.example.com +584121234567',
      status: null,
      archived: false,
    });
  });

  it('a new primary contact demotes the previous one, which is logged (CA2)', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    const first = await w.createContact.execute(w.owner, {
      ...contactInput({ isPrimary: true }),
      clientId: client.id,
    });
    const second = await w.createContact.execute(w.owner, {
      ...contactInput({ fullName: 'Bruno', isPrimary: true }),
      clientId: client.id,
    });
    expect(w.contacts.get(first.contact.id)?.isPrimary).toBe(false);
    expect(w.contacts.get(second.contact.id)?.isPrimary).toBe(true);
    expect(w.activity.entries.filter((e) => e.action === 'UPDATE')).toEqual([
      expect.objectContaining({
        entityId: first.contact.id,
        clientId: client.id,
        changes: { isPrimary: [true, false] },
      }),
    ]);
  });

  it('assigns tags and rejects an unknown tag id with VALIDATION', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    w.seedTag('tag_a', 'Alfa');
    const view = await w.createContact.execute(w.owner, {
      ...contactInput({ tagIds: ['tag_a'] }),
      clientId: client.id,
    });
    expect(view.tags.map((t) => t.name)).toEqual(['Alfa']);
    const error = await rejection(
      w.createContact.execute(w.owner, {
        ...contactInput({ tagIds: ['tag_nope'] }),
        clientId: client.id,
      }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(w.contacts.rows).toHaveLength(1);
  });

  it('answers NOT_FOUND on an unknown or archived client (live client required)', async () => {
    const w = createWorld();
    const archived = w.seedClient({ deletedAt: new Date() }).client;
    for (const clientId of ['cli_nope', archived.id]) {
      expect(
        (await rejection(w.createContact.execute(w.owner, { ...contactInput(), clientId }))).code,
      ).toBe('NOT_FOUND');
    }
    expect(w.contacts.rows).toHaveLength(0);
  });

  it('needs a name and an e-mail or phone (CA1)', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    const error = await rejection(
      w.createContact.execute(w.owner, { fullName: 'Ana', clientId: client.id }),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { email: ['validation.required'], phone: ['validation.required'] },
    });
  });

  it('is FORBIDDEN for Member and Viewer', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    for (const user of [w.member, w.viewer]) {
      expect(
        (await rejection(w.createContact.execute(user, { ...contactInput(), clientId: client.id })))
          .code,
      ).toBe('FORBIDDEN');
    }
  });
});
