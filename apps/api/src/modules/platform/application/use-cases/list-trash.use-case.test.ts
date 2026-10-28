import { describe, expect, it } from 'vitest';
import { FakeAuthorization } from '../../../../../test/support/fakes/fake-authorization';
import {
  FakeRestoreHandler,
  admin,
  buildTrashHarness,
  member,
  owner,
  viewer,
} from '../../../../../test/trash/harness';
import { ListTrash } from './list-trash.use-case';

const base = { page: 1, pageSize: 25, sort: { field: 'deletedAt', direction: 'desc' } } as const;

function setup() {
  const h = buildTrashHarness();
  h.registry.register(new FakeRestoreHandler('CLIENT', 'client'));
  h.registry.register(new FakeRestoreHandler('PROJECT', 'project'));
  h.registry.register(new FakeRestoreHandler('NOTE', 'note'));
  return h;
}

describe('ListTrash', () => {
  it('reads only the registered types, in registration order', async () => {
    const h = setup();
    await h.listTrash.execute(owner, base);
    expect(h.read.queries[0]?.entityTypes).toEqual(['CLIENT', 'PROJECT', 'NOTE']);
  });

  it('intersects with the entityType filter and ignores unregistered requested types', async () => {
    const h = setup();
    await h.listTrash.execute(admin, { ...base, entityType: ['PROJECT', 'INVOICE'] });
    expect(h.read.queries[0]?.entityTypes).toEqual(['PROJECT']);
  });

  it('drops the types whose resource the actor cannot read', async () => {
    const h = setup();
    const policy = new FakeAuthorization({
      policy: (_user, _action, resource) => resource !== 'project',
    });
    const listTrash = new ListTrash(policy, h.registry, h.read);
    await listTrash.execute(owner, base);
    expect(h.read.queries[0]?.entityTypes).toEqual(['CLIENT', 'NOTE']);
  });

  it('answers an empty page without reading when no readable type is left', async () => {
    const h = setup();
    const page = await h.listTrash.execute(owner, { ...base, entityType: ['INVOICE'] });
    expect(page).toMatchObject({ items: [], total: 0, page: 1, pageCount: 1 });
    expect(h.read.queries).toHaveLength(0);
    const empty = buildTrashHarness();
    expect((await empty.listTrash.execute(owner, base)).items).toEqual([]);
    expect(empty.read.queries).toHaveLength(0);
  });

  it('passes the date, actor, text, sort and paging filters through', async () => {
    const h = setup();
    await h.listTrash.execute(owner, {
      page: 2,
      pageSize: 50,
      sort: { field: 'label', direction: 'asc' },
      q: 'veredas',
      deletedFrom: '2026-10-01',
      deletedTo: '2026-10-20',
      deletedById: ['usr_a'],
    });
    expect(h.read.queries[0]).toMatchObject({
      page: 2,
      pageSize: 50,
      sort: { field: 'label', direction: 'asc' },
      q: 'veredas',
      deletedFrom: '2026-10-01',
      deletedTo: '2026-10-20',
      deletedById: ['usr_a'],
    });
  });

  it('is Owner/Admin only and reads nothing for others', async () => {
    const h = setup();
    for (const actor of [member, viewer]) {
      await expect(h.listTrash.execute(actor, base)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(h.read.queries).toHaveLength(0);
  });

  it('returns the port page unchanged', async () => {
    const h = setup();
    h.read.rows = [
      {
        entity: { type: 'CLIENT', id: 'c1', code: 'CLI-1', label: 'Veredas' },
        context: null,
        deletedAt: new Date('2026-10-20T10:00:00Z'),
        deletedBy: null,
      },
    ];
    const page = await h.listTrash.execute(owner, base);
    expect(page.items).toEqual(h.read.rows);
    expect(page.total).toBe(1);
  });
});
