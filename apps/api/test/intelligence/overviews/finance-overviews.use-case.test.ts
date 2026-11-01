import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/shared/domain/domain-error';
import { GetInvoicesOverview } from '../../../src/modules/intelligence/application/use-cases/overviews/get-invoices-overview.use-case';
import { GetPaymentsOverview } from '../../../src/modules/intelligence/application/use-cases/overviews/get-payments-overview.use-case';
import { authorization, userOf, world } from './world';

describe('GetInvoicesOverview', () => {
  function build() {
    const w = world();
    return { ...w, useCase: new GetInvoicesOverview(authorization, w.facts, w.overview, w.clock) };
  }

  it('bills against collects over the last six months, months without facts as zeros', async () => {
    const { facts, useCase } = build();
    facts.addFact({ kind: 'BILLED', amountUsd: '100.10', date: '2026-05-01' });
    facts.addFact({ kind: 'BILLED', amountUsd: '0.20', date: '2026-05-31' });
    facts.addFact({ kind: 'COLLECTED', amountUsd: '40.00', date: '2026-10-15' });
    // Outside the window: April is the seventh month back, and the window ends with the current month.
    facts.addFact({ kind: 'BILLED', amountUsd: '999.00', date: '2026-04-30' });
    facts.addFact({ kind: 'BILLED', amountUsd: '999.00', date: '2026-11-01' });

    const overview = await useCase.execute(userOf('OWNER'));

    expect(overview.periods).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(overview.billed).toEqual(['100.30', '0.00', '0.00', '0.00', '0.00', '0.00']);
    expect(overview.collected).toEqual(['0.00', '0.00', '0.00', '0.00', '0.00', '40.00']);
  });

  it('ages the open receivable by days past due at today, from the facts (DT-125)', async () => {
    const { facts, useCase } = build();
    facts.addFact({
      kind: 'BILLED',
      amountUsd: '100.00',
      date: '2026-09-01',
      invoiceId: 'inv_a',
      clientId: 'cli_a',
      dueDate: '2026-10-10',
    });
    facts.addFact({
      kind: 'BILLED',
      amountUsd: '70.00',
      date: '2026-05-01',
      invoiceId: 'inv_b',
      clientId: 'cli_a',
      dueDate: '2026-06-01',
    });
    facts.addFact({
      kind: 'COLLECTED',
      amountUsd: '30.00',
      date: '2026-10-01',
      invoiceId: 'inv_a',
      clientId: 'cli_a',
    });

    const overview = await useCase.execute(userOf('OWNER'));

    expect(overview.aging).toEqual({
      d0_30: '70.00',
      d31_60: '0.00',
      d61_90: '0.00',
      d90plus: '70.00',
    });
  });

  it('counts the overdue invoices and lists the totals per currency as the read port gives them', async () => {
    const { overview: read, useCase } = build();
    read.invoiceTotals = [
      { currency: 'USD', total: '500.00', balance: '200.00', overdue: '50.00', overdueCount: 1 },
      { currency: 'VES', total: '9000.00', balance: '9000.00', overdue: '0.00', overdueCount: 0 },
    ];
    const overview = await useCase.execute(userOf('ADMIN'));
    expect(overview.overdueCount).toBe(1);
    expect(overview.totalsByCurrency).toEqual(
      read.invoiceTotals.map(({ overdueCount: _, ...r }) => r),
    );
  });

  it.each(['MEMBER', 'VIEWER'] as const)('%s is forbidden (DT-175)', async (role) => {
    const { useCase } = build();
    await expect(useCase.execute(userOf(role))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('GetPaymentsOverview', () => {
  function build() {
    const w = world();
    return { ...w, useCase: new GetPaymentsOverview(authorization, w.facts, w.overview, w.clock) };
  }

  it('collects per month over 12 months from the allocations (DT-98), zeros where nothing was collected', async () => {
    const { facts, useCase } = build();
    facts.addFact({ kind: 'COLLECTED', amountUsd: '800.00', date: '2026-09-10' });
    facts.addFact({ kind: 'COLLECTED', amountUsd: '0.10', date: '2025-11-01' });
    facts.addFact({ kind: 'COLLECTED', amountUsd: '999.00', date: '2025-10-31' });

    const overview = await useCase.execute(userOf('OWNER'));

    expect(overview.collectedByMonth).toHaveLength(12);
    expect(overview.collectedByMonth[0]).toEqual({ period: '2025-11', value: '0.10' });
    expect(overview.collectedByMonth.at(-1)).toEqual({ period: '2026-10', value: '0.00' });
    expect(overview.collectedByMonth.find((p) => p.period === '2026-09')?.value).toBe('800.00');
  });

  it('breaks the collected amount down by method code and by account name, largest first', async () => {
    const { facts, overview: read, useCase } = build();
    read.methods.set('met_z', { code: 'ZELLE', name: 'Zelle' });
    read.methods.set('met_p', { code: 'PAGO_MOVIL', name: 'Pago móvil' });
    read.accounts.set('acc_1', 'Banesco');
    read.accounts.set('acc_2', 'Mercantil');
    const collect = (methodId: string, accountId: string, amountUsd: string) =>
      facts.addFact({ kind: 'COLLECTED', amountUsd, date: '2026-09-10', methodId, accountId });
    collect('met_z', 'acc_1', '900.00');
    collect('met_p', 'acc_2', '1000.00');
    collect('met_z', 'acc_2', '0.50');

    const overview = await useCase.execute(userOf('OWNER'));

    expect(overview.byMethod).toEqual([
      { key: 'PAGO_MOVIL', label: 'Pago móvil', value: '1000.00' },
      { key: 'ZELLE', label: 'Zelle', value: '900.50' },
    ]);
    expect(overview.byAccount).toEqual([
      { key: 'acc_2', label: 'Mercantil', value: '1000.50' },
      { key: 'acc_1', label: 'Banesco', value: '900.00' },
    ]);
  });

  it('reports the verification and credit queues from the read port', async () => {
    const { overview: read, useCase } = build();
    read.queues = {
      pendingVerificationCount: 2,
      unallocatedCount: 1,
      unallocatedTotalUsd: '97.00',
    };
    const overview = await useCase.execute(userOf('ADMIN'));
    expect(overview).toMatchObject(read.queues);
  });

  it.each(['MEMBER', 'VIEWER'] as const)('%s is forbidden (DT-175)', async (role) => {
    const { useCase } = build();
    await expect(useCase.execute(userOf(role))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
