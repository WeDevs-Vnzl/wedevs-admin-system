import { describe, expect, it } from 'vitest';
import { contactInput, createWorld, rejection } from '../../../../../test/commercial/clients/world';

async function setup() {
  const w = createWorld();
  const { client } = w.seedClient();
  const { contact } = await w.createContact.execute(w.owner, {
    ...contactInput(),
    clientId: client.id,
  });
  return { w, client, contact };
}

describe('UpdateContact', () => {
  it('applies the change, logs the UPDATE diff and reindexes', async () => {
    const { w, client, contact } = await setup();
    const view = await w.updateContact.execute(w.owner, {
      ...contactInput({ fullName: 'Ana María', position: 'CEO' }),
      id: contact.id,
    });
    expect(view.contact).toMatchObject({ fullName: 'Ana María', position: 'CEO' });
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'UPDATE',
      entityId: contact.id,
      entityLabel: 'Ana María',
      clientId: client.id,
      changes: { fullName: ['Ana Pérez', 'Ana María'], position: [null, 'CEO'] },
    });
    expect(w.search.get('CONTACT', contact.id)).toMatchObject({
      title: 'Ana María',
      subtitle: 'CEO',
    });
  });

  it('setting isPrimary through update keeps a single primary', async () => {
    const { w, client, contact } = await setup();
    const other = await w.createContact.execute(w.owner, {
      ...contactInput({ fullName: 'Bruno', isPrimary: true }),
      clientId: client.id,
    });
    await w.updateContact.execute(w.owner, {
      ...contactInput({ isPrimary: true }),
      id: contact.id,
    });
    expect(w.contacts.get(contact.id)?.isPrimary).toBe(true);
    expect(w.contacts.get(other.contact.id)?.isPrimary).toBe(false);
    expect(w.contacts.rows.filter((c) => c.isPrimary)).toHaveLength(1);
  });

  it('does not log anything when nothing changed', async () => {
    const { w, contact } = await setup();
    const before = w.activity.entries.length;
    await w.updateContact.execute(w.owner, { ...contactInput(), id: contact.id });
    expect(w.activity.entries).toHaveLength(before);
  });

  it('logs sorted tag names joined with ", ", never ids (CR-B4, C1)', async () => {
    const { w, contact } = await setup();
    w.seedTag('tag_z', 'zeta');
    w.seedTag('tag_a', 'Álamo');
    await w.updateContact.execute(w.owner, {
      ...contactInput({ tagIds: ['tag_z', 'tag_a'] }),
      id: contact.id,
    });
    const entry = w.activity.entries.at(-1);
    expect(entry?.changes).toEqual({ tagIds: ['', 'Álamo, zeta'] });
    expect(JSON.stringify(entry?.changes)).not.toMatch(/tag_/);
  });

  it('answers NOT_FOUND for an unknown or archived contact', async () => {
    const { w, contact } = await setup();
    await w.archiveContact.execute(w.owner, { id: contact.id });
    for (const id of ['con_nope', contact.id]) {
      expect(
        (await rejection(w.updateContact.execute(w.owner, { ...contactInput(), id }))).code,
      ).toBe('NOT_FOUND');
    }
  });

  it('is FORBIDDEN for Member and Viewer', async () => {
    const { w, contact } = await setup();
    for (const user of [w.member, w.viewer]) {
      expect(
        (await rejection(w.updateContact.execute(user, { ...contactInput(), id: contact.id })))
          .code,
      ).toBe('FORBIDDEN');
    }
  });
});
