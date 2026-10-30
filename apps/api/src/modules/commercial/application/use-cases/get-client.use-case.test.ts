import { describe, expect, it } from 'vitest';
import { createWorld, nth, rejection } from '../../../../../test/commercial/clients/world';

describe('GetClient', () => {
  it('returns the detail with live contacts, primary first, tags and no financials', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient({ id: 'cli_1' }, 3);
    w.contacts.seed({ ...nth(contacts, 1), isPrimary: true, fullName: 'Zoe' });
    w.contacts.seed({ ...nth(contacts, 2), deletedAt: new Date() });
    w.seedTag('tag_a', 'Alfa');
    await w.uow.run(() =>
      w.assignments.replace(w.owner, { entityType: 'CLIENT', entityId: client.id }, ['tag_a']),
    );

    const detail = await w.getClient.execute(w.member, { id: client.id });
    expect(detail.client.id).toBe(client.id);
    expect(detail.tags).toEqual([{ id: 'tag_a', name: 'Alfa', color: '#112233' }]);
    expect(detail.contacts).toHaveLength(2);
    expect(detail.contacts[0]?.contact).toMatchObject({ isPrimary: true, fullName: 'Zoe' });
    expect(detail.contacts.every((c) => c.contact.deletedAt === null)).toBe(true);
    expect(detail).not.toHaveProperty('financials');
  });

  it('answers NOT_FOUND for an unknown id and for an archived client when the role cannot see archived', async () => {
    const w = createWorld();
    const archived = w.seedClient({ deletedAt: new Date() }).client;
    for (const user of [w.member, w.viewer]) {
      expect((await rejection(w.getClient.execute(user, { id: 'cli_nope' }))).code).toBe(
        'NOT_FOUND',
      );
      expect((await rejection(w.getClient.execute(user, { id: archived.id }))).code).toBe(
        'NOT_FOUND',
      );
    }
    for (const user of [w.owner, w.admin]) {
      expect(
        (await w.getClient.execute(user, { id: archived.id })).client.deletedAt,
      ).not.toBeNull();
    }
  });
});
