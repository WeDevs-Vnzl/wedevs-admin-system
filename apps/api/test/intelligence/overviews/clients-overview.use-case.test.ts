import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/shared/domain/domain-error';
import { GetClientsOverview } from '../../../src/modules/intelligence/application/use-cases/overviews/get-clients-overview.use-case';
import type { ClientListRow } from '../../../src/modules/commercial/application/use-cases/client-support';
import { authorization, clientRow, FakeListSource, userOf, world } from './world';

function build() {
  const w = world();
  const clients = new FakeListSource<ClientListRow>();
  const useCase = new GetClientsOverview(authorization, clients, w.metrics, w.facts, w.clock);
  return { ...w, clients, useCase };
}

describe('GetClientsOverview', () => {
  it('counts live clients by status and lists the five newest, newest first', async () => {
    const { clients, metrics, useCase } = build();
    metrics.addClient({ id: 'a', tradeName: 'A', status: 'ACTIVO' });
    metrics.addClient({ id: 'b', tradeName: 'B', status: 'PROSPECTO' });
    metrics.addClient({ id: 'z', tradeName: 'Z', status: 'ACTIVO', archived: true });
    clients.items = ['2026-01-01', '2026-06-01', '2026-03-01'].map((createdAt, i) =>
      clientRow(`c${i}`, `C${i}`, createdAt),
    );

    const overview = await useCase.execute(userOf('OWNER'));

    expect(overview.countByStatus).toEqual({ PROSPECTO: 1, ACTIVO: 1, INACTIVO: 0 });
    // The owner of the list sorts; the overview only asks for the newest, live rows.
    expect(clients.queries[0]?.query).toMatchObject({
      sort: { field: 'createdAt', direction: 'desc' },
      archived: 'exclude',
    });
    expect(overview.recentlyCreated.map((row) => row.client.id)).toEqual(['c0', 'c1', 'c2']);
    expect(overview.topByRevenue).toEqual([]);
    expect(overview.withOverdueBalance).toEqual([]);
  });

  it('keeps at most five in recentlyCreated', async () => {
    const { clients, useCase } = build();
    clients.items = Array.from({ length: 8 }, (_, i) => clientRow(`c${i}`, `C${i}`, '2026-01-01'));
    const overview = await useCase.execute(userOf('OWNER'));
    expect(overview.recentlyCreated).toHaveLength(5);
  });

  it('ranks the top clients by what they collected in the last 12 months, from the facts', async () => {
    const { clients, facts, useCase } = build();
    clients.items = [
      clientRow('a', 'A', '2026-01-01'),
      clientRow('b', 'B', '2026-01-01'),
      clientRow('c', 'C', '2026-01-01'),
    ];
    const collect = (clientId: string, amountUsd: string, date: string) =>
      facts.addFact({ kind: 'COLLECTED', clientId, amountUsd, date });
    collect('a', '100.10', '2026-08-01');
    collect('a', '0.20', '2026-09-01');
    collect('b', '300.00', '2025-11-01');
    // Outside the window: the 12 months end with October 2026 and begin in November 2025.
    collect('b', '900.00', '2025-10-31');
    collect('c', '900.00', '2024-01-01');

    const overview = await useCase.execute(userOf('OWNER'));

    expect(overview.topByRevenue.map((r) => [r.row.client.id, r.collectedLast12MonthsUsd])).toEqual(
      [
        ['b', '300.00'],
        ['a', '100.30'],
      ],
    );
  });

  it('skips a ranked client that is not a live row and stops at five', async () => {
    const { clients, facts, useCase } = build();
    clients.items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => clientRow(id, id, '2026-01-01'));
    for (const [i, id] of ['gone', 'a', 'b', 'c', 'd', 'e', 'f'].entries()) {
      facts.addFact({
        kind: 'COLLECTED',
        clientId: id,
        amountUsd: `${100 - i}.00`,
        date: '2026-09-01',
      });
    }
    const overview = await useCase.execute(userOf('OWNER'));
    expect(overview.topByRevenue.map((r) => r.row.client.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('lists up to ten clients with an overdue balance, the largest first, with that balance', async () => {
    const { clients, metrics, useCase } = build();
    clients.items = [clientRow('a', 'A', '2026-01-01'), clientRow('b', 'B', '2026-01-01')];
    metrics.addClient({ id: 'a', tradeName: 'A', metrics: { overdueUsd: '40.00' } });
    metrics.addClient({ id: 'b', tradeName: 'B', metrics: { overdueUsd: '75.50' } });
    metrics.addClient({ id: 'n', tradeName: 'N' });

    const overview = await useCase.execute(userOf('ADMIN'));

    expect(overview.withOverdueBalance.map((r) => [r.row.client.id, r.overdueUsd])).toEqual([
      ['b', '75.50'],
      ['a', '40.00'],
    ]);
  });

  it('finds ranked clients on later pages of the list', async () => {
    const { clients, facts, useCase } = build();
    clients.items = Array.from({ length: 130 }, (_, i) =>
      clientRow(`c${String(i).padStart(3, '0')}`, `C${i}`, '2026-01-01'),
    );
    facts.addFact({ kind: 'COLLECTED', clientId: 'c125', amountUsd: '10.00', date: '2026-09-01' });
    const overview = await useCase.execute(userOf('OWNER'));
    expect(overview.topByRevenue.map((r) => r.row.client.id)).toEqual(['c125']);
  });

  it.each(['MEMBER', 'VIEWER'] as const)(
    '%s sees counts and the newest clients but no client ranked by money, in membership or order (X15)',
    async (role) => {
      const { clients, facts, metrics, useCase } = build();
      clients.items = [clientRow('a', 'A', '2026-02-01'), clientRow('b', 'B', '2026-01-01')];
      metrics.addClient({ id: 'a', tradeName: 'A', metrics: { overdueUsd: '40.00' } });
      facts.addFact({ kind: 'COLLECTED', clientId: 'a', amountUsd: '5.00', date: '2026-09-01' });

      const overview = await useCase.execute(userOf(role));

      expect(overview.countByStatus.ACTIVO).toBe(1);
      expect(overview.recentlyCreated.map((r) => r.client.id)).toEqual(['a', 'b']);
      expect(overview.topByRevenue).toEqual([]);
      expect(overview.withOverdueBalance).toEqual([]);
      // Only the newest-first page was read: nothing was fetched to rank by money.
      expect(clients.queries).toHaveLength(1);
    },
  );

  it('is forbidden without read on clients, before any read', async () => {
    const { clients, metrics, facts, clock } = build();
    const denied = new GetClientsOverview(
      { can: () => false, canSeeFinancials: () => false },
      clients,
      metrics,
      facts,
      clock,
    );
    await expect(denied.execute(userOf('OWNER'))).rejects.toBeInstanceOf(ForbiddenError);
    expect(clients.queries).toEqual([]);
  });
});
