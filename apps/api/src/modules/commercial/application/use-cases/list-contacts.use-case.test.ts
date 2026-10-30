import { describe, expect, it } from 'vitest';
import { createWorld, nth, query, rejection } from '../../../../../test/commercial/clients/world';

describe('ListContacts', () => {
  it('lists the live contacts of the client, primary first, with their tags', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient({}, 3);
    w.contacts.seed({ ...nth(contacts, 1), isPrimary: true });
    w.contacts.seed({ ...nth(contacts, 2), deletedAt: new Date() });
    w.seedClient({}, 2);
    w.seedTag('tag_a', 'Alfa');
    await w.uow.run(() =>
      w.assignments.replace(w.owner, { entityType: 'CONTACT', entityId: nth(contacts, 1).id }, [
        'tag_a',
      ]),
    );

    const page = await w.listContacts.execute(w.viewer, { clientId: client.id, query: query() });
    expect(page.total).toBe(2);
    expect(page.items[0]?.contact.id).toBe(nth(contacts, 1).id);
    expect(page.items[0]?.tags).toEqual([{ id: 'tag_a', name: 'Alfa', color: '#112233' }]);
    expect(page.items[1]?.tags).toEqual([]);
  });

  it('shows archived contacts only with archived=include|only and the trash grant (C19)', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient({}, 2);
    w.contacts.seed({ ...nth(contacts, 1), deletedAt: new Date() });
    const include = query({ archived: 'include' });
    expect(
      (await w.listContacts.execute(w.owner, { clientId: client.id, query: include })).total,
    ).toBe(2);
    expect(
      (
        await w.listContacts.execute(w.admin, {
          clientId: client.id,
          query: query({ archived: 'only' }),
        })
      ).total,
    ).toBe(1);
    for (const user of [w.member, w.viewer]) {
      const page = await w.listContacts.execute(user, { clientId: client.id, query: include });
      expect(page.total).toBe(1);
    }
    expect(w.contacts.listQueries.at(-1)?.query.archived).toBe('exclude');
  });

  it('returns an empty page for a client without contacts', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    const page = await w.listContacts.execute(w.member, { clientId: client.id, query: query() });
    expect(page).toMatchObject({ items: [], total: 0, pageCount: 1 });
  });

  it('answers NOT_FOUND for an unknown client, and for an archived one when the role cannot see archived', async () => {
    const w = createWorld();
    const archived = w.seedClient({ deletedAt: new Date() }).client;
    expect(
      (await rejection(w.listContacts.execute(w.owner, { clientId: 'cli_nope', query: query() })))
        .code,
    ).toBe('NOT_FOUND');
    expect(
      (await rejection(w.listContacts.execute(w.member, { clientId: archived.id, query: query() })))
        .code,
    ).toBe('NOT_FOUND');
    await expect(
      w.listContacts.execute(w.owner, {
        clientId: archived.id,
        query: query({ archived: 'include' }),
      }),
    ).resolves.toBeDefined();
  });
});
