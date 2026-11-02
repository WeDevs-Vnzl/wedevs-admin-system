import { beforeEach, describe, expect, it } from 'vitest';
import { computeProjectMargin } from '../../../src/modules/finance/application/kpi-api';
import {
  ZERO_CLIENT_METRICS,
  ZERO_PROJECT_METRICS,
} from '../../support/fakes/in-memory-entity-metrics-read';
import type { AuthorizationPort } from '../../../src/shared/application/ports/authorization.port';
import { GetClientSummary } from '../../../src/modules/intelligence/application/use-cases/dashboard/get-client-summary.use-case';
import { GetProjectSummary } from '../../../src/modules/intelligence/application/use-cases/dashboard/get-project-summary.use-case';
import { buildDashboardWorld, userOf, type DashboardWorld } from './dashboard-world';

/** A grant set that sees financials but cannot restore from the trash. */
const WITHOUT_RESTORE: AuthorizationPort = {
  can: (_user, action) => action !== 'restore',
  canSeeFinancials: () => true,
};

function seedClient(world: DashboardWorld, id: string, archived = false): void {
  world.panels.clients.set(id, {
    archived,
    metrics: {
      clientId: id,
      code: `CLI-${id}`,
      tradeName: id,
      status: 'ACTIVO',
      ...ZERO_CLIENT_METRICS,
      invoicedUsd: '1000.00',
      collectedUsd: '600.00',
      receivableUsd: '400.00',
      overdueUsd: '150.00',
      creditUsd: '25.50',
      projectCount: 2,
    },
  });
}

function seedProject(
  world: DashboardWorld,
  id: string,
  model: 'PRECIO_FIJO' | 'RECURRENTE' | null,
  archived = false,
) {
  const marginUsd = '210.00';
  const collectedUsd = '700.00';
  world.panels.projects.set(id, {
    archived,
    model,
    metrics: {
      projectId: id,
      code: `PRJ-${id}`,
      name: id,
      status: 'EN_CURSO',
      ...ZERO_PROJECT_METRICS,
      contractedUsd: '2000.00',
      invoicedUsd: '1000.00',
      collectedUsd,
      toInvoiceUsd: '1000.00',
      receivableUsd: '300.00',
      expensesUsd: '490.00',
      marginUsd,
      monthlyRecurringUsd: '50.00',
      marginPercent: computeProjectMargin({ collectedUsd, allocatedExpensesUsd: '490.00' }),
    },
  });
}

describe('GetClientSummary', () => {
  let world: DashboardWorld;
  beforeEach(() => {
    world = buildDashboardWorld();
    seedClient(world, 'c1');
  });

  it('returns the stored metrics and the rolling twelve months from facts (Δ6)', async () => {
    const f = world.facts;
    // today 2026-01-15: the window is 2025-01-15 (365 days back) to today
    f.addFact({ kind: 'COLLECTED', date: '2025-01-14', amountUsd: '999.00', clientId: 'c1' });
    f.addFact({ kind: 'COLLECTED', date: '2025-01-15', amountUsd: '100.10', clientId: 'c1' });
    f.addFact({ kind: 'COLLECTED', date: '2026-01-15', amountUsd: '0.20', clientId: 'c1' });
    f.addFact({ kind: 'COLLECTED', date: '2025-06-01', amountUsd: '500.00', clientId: 'other' });
    expect(await world.clientSummary.execute(userOf('OWNER'), { id: 'c1' })).toEqual({
      clientId: 'c1',
      totalInvoicedUsd: '1000.00',
      totalCollectedUsd: '600.00',
      receivableUsd: '400.00',
      overdueUsd: '150.00',
      creditBalanceUsd: '25.50',
      projectCount: 2,
      collectedLast12MonthsUsd: '100.30',
    });
  });

  it.each(['MEMBER', 'VIEWER'] as const)(
    'is FORBIDDEN for %s, before touching data',
    async (role) => {
      await expect(world.clientSummary.execute(userOf(role), { id: 'c1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(world.panels.reads).toBe(0);
    },
  );

  it('answers NOT_FOUND for an unknown id', async () => {
    await expect(
      world.clientSummary.execute(userOf('ADMIN'), { id: 'nope' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('shows an archived client to the roles that restore, and hides it from the others (C19)', async () => {
    seedClient(world, 'gone', true);
    expect((await world.clientSummary.execute(userOf('OWNER'), { id: 'gone' })).clientId).toBe(
      'gone',
    );
    const noRestore = new GetClientSummary(WITHOUT_RESTORE, world.panels, world.facts, world.clock);
    await expect(noRestore.execute(userOf('OWNER'), { id: 'gone' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('GetProjectSummary', () => {
  let world: DashboardWorld;
  beforeEach(() => {
    world = buildDashboardWorld();
    seedProject(world, 'p1', 'PRECIO_FIJO');
    seedProject(world, 'p2', 'RECURRENTE');
    seedProject(world, 'p3', null);
  });

  it('returns the §8.4.4 summary from the stored metrics', async () => {
    expect(await world.projectSummary.execute(userOf('OWNER'), { id: 'p1' })).toEqual({
      projectId: 'p1',
      currency: 'USD',
      contractedValue: '2000.00',
      invoiced: '1000.00',
      collected: '700.00',
      toInvoice: '1000.00',
      receivable: '300.00',
      monthlyRecurring: '50.00',
      allocatedExpenses: '490.00',
      margin: '210.00',
      marginPercent: '30.00',
    });
  });

  it('"to invoice" applies to fixed-price and mixed plans only', async () => {
    for (const id of ['p2', 'p3']) {
      expect((await world.projectSummary.execute(userOf('ADMIN'), { id })).toInvoice).toBeNull();
    }
  });

  it.each(['MEMBER', 'VIEWER'] as const)('is FORBIDDEN for %s', async (role) => {
    await expect(world.projectSummary.execute(userOf(role), { id: 'p1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(world.panels.reads).toBe(0);
  });

  it('answers NOT_FOUND for an unknown project', async () => {
    await expect(world.projectSummary.execute(userOf('OWNER'), { id: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('shows an archived project to the trash roles and hides it otherwise', async () => {
    seedProject(world, 'gone', 'PRECIO_FIJO', true);
    expect((await world.projectSummary.execute(userOf('OWNER'), { id: 'gone' })).projectId).toBe(
      'gone',
    );
    const noRestore = new GetProjectSummary(WITHOUT_RESTORE, world.panels);
    await expect(noRestore.execute(userOf('OWNER'), { id: 'gone' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
