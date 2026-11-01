import { describe, expect, it } from 'vitest';
import { createWorld, query, rejection } from '../../../../../test/commercial/clients/world';
import { clientListQueryOf } from './list-clients.use-case';

describe('clientListQueryOf', () => {
  it('maps the whitelisted filters, defaulting to code:asc', () => {
    expect(
      clientListQueryOf(
        query({
          q: 'kairos',
          filters: {
            status: ['ACTIVO', 'INACTIVO'],
            kind: 'EMPRESA',
            country: ['VE'],
            tagId: 'tag_a',
            createdFrom: '2026-01-01',
            createdTo: '2026-01-31',
            hasOverdue: 'false',
          },
        }),
        'exclude',
      ),
    ).toEqual({
      page: 1,
      pageSize: 25,
      sort: { field: 'code', direction: 'asc' },
      archived: 'exclude',
      q: 'kairos',
      status: ['ACTIVO', 'INACTIVO'],
      kind: ['EMPRESA'],
      country: ['VE'],
      tagIds: ['tag_a'],
      createdFrom: '2026-01-01',
      createdTo: '2026-01-31',
      hasOverdue: false,
    });
  });

  it('omits filters that were not sent', () => {
    expect(clientListQueryOf(query(), 'only')).toEqual({
      page: 1,
      pageSize: 25,
      sort: { field: 'code', direction: 'asc' },
      archived: 'only',
    });
  });
});

describe('ListClients', () => {
  it('lists the rows with tags and the ClientMetrics columns (CA: projectCount, lastActivityAt, money)', async () => {
    const w = createWorld();
    const { client } = w.seedClient({ id: 'cli_1', code: 'CLI-0001' });
    const bare = w.seedClient({ id: 'cli_2', code: 'CLI-0002' }).client;
    const at = new Date('2026-02-01T00:00:00.000Z');
    w.clients.metrics.set(client.id, {
      projectCount: 2,
      lastActivityAt: at,
      totalInvoicedUsd: '120.50',
      receivableUsd: '80.00',
    });
    w.seedTag('tag_a', 'Alfa');
    await w.uow.run(() =>
      w.assignments.replace(w.owner, { entityType: 'CLIENT', entityId: client.id }, ['tag_a']),
    );

    const page = await w.listClients.execute(w.owner, query());
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({
      projectCount: 2,
      lastActivityAt: at,
      totalInvoicedUsd: '120.50',
      receivableUsd: '80.00',
      tags: [{ id: 'tag_a', name: 'Alfa', color: '#112233' }],
    });
    // The client without a metrics row reads as zero.
    expect(page.items[1]).toMatchObject({
      client: { id: bare.id },
      projectCount: 0,
      lastActivityAt: null,
      totalInvoicedUsd: '0.00',
      receivableUsd: '0.00',
      tags: [],
    });
  });

  it('passes the parsed filters and the default sort to the repository', async () => {
    const w = createWorld();
    await w.listClients.execute(
      w.owner,
      query({ q: 'x', filters: { hasOverdue: 'true', status: 'ACTIVO' } }),
    );
    expect(w.clients.listQueries[0]).toMatchObject({
      sort: { field: 'code', direction: 'asc' },
      hasOverdue: true,
      status: ['ACTIVO'],
      q: 'x',
    });
  });

  it('honours archived for Owner and Admin and treats it as exclude for Member and Viewer (C19)', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const w = createWorld();
      w.seedClient({ id: 'cli_live' });
      w.seedClient({ id: 'cli_gone', deletedAt: new Date() });
      const page = await w.listClients.execute(w[role], query({ archived: 'include' }));
      expect(page.items.map((row) => row.client.id).sort()).toEqual(['cli_gone', 'cli_live']);
    }
    for (const role of ['member', 'viewer'] as const) {
      const w = createWorld();
      w.seedClient({ id: 'cli_live' });
      w.seedClient({ id: 'cli_gone', deletedAt: new Date() });
      const page = await w.listClients.execute(w[role], query({ archived: 'include' }));
      expect(page.items.map((row) => row.client.id)).toEqual(['cli_live']);
      expect(w.clients.listQueries[0]?.archived).toBe('exclude');
    }
  });

  describe('money gates without canSeeFinancials (C13)', () => {
    it('returns null money fields for Member and Viewer, strings for Owner and Admin', async () => {
      const w = createWorld();
      const { client } = w.seedClient();
      w.clients.metrics.set(client.id, {
        projectCount: 1,
        lastActivityAt: null,
        totalInvoicedUsd: '10.00',
        receivableUsd: '5.00',
      });
      for (const user of [w.member, w.viewer]) {
        const [row] = (await w.listClients.execute(user, query())).items;
        expect(row).toMatchObject({ totalInvoicedUsd: null, receivableUsd: null, projectCount: 1 });
      }
      for (const user of [w.owner, w.admin]) {
        const [row] = (await w.listClients.execute(user, query())).items;
        expect(row).toMatchObject({ totalInvoicedUsd: '10.00', receivableUsd: '5.00' });
      }
    });

    it('answers 422 for a money sort key and for the hasOverdue filter', async () => {
      const w = createWorld();
      for (const field of ['receivableUsd', 'totalInvoicedUsd']) {
        const error = await rejection(
          w.listClients.execute(w.member, query({ sort: { field, direction: 'asc' } })),
        );
        expect(error).toMatchObject({
          code: 'VALIDATION',
          fieldErrors: { sort: ['validation.sort.invalid'] },
        });
      }
      const overdue = await rejection(
        w.listClients.execute(w.viewer, query({ filters: { hasOverdue: 'true' } })),
      );
      expect(overdue).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { hasOverdue: ['validation.invalidOption'] },
      });
      expect(w.clients.listQueries).toHaveLength(0);
    });

    it('lets non-money sorts through, and lets Owner and Admin sort by money', async () => {
      const w = createWorld();
      await w.listClients.execute(
        w.member,
        query({ sort: { field: 'projectCount', direction: 'desc' } }),
      );
      await w.listClients.execute(
        w.admin,
        query({ sort: { field: 'receivableUsd', direction: 'asc' } }),
      );
      expect(w.clients.listQueries.map((q) => q.sort.field)).toEqual([
        'projectCount',
        'receivableUsd',
      ]);
    });
  });
});
