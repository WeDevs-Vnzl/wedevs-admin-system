import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedClient, seedInvoice, seedProject } from '../../../../test/finance/read-models/world';
import { buildPrismaWorld } from '../../../../test/finance/billing/prisma-world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import type { NewInstallment } from '../application/ports/billing.repository.port';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const { uow, host, repository } = buildPrismaWorld(service);
const AT = new Date('2026-10-09T15:00:00.000Z');

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(async () => {
  await truncateBusinessTables(admin);
  await uow.run(async () => {
    await seedClient(host.db, 'cli_a');
    await seedProject(host.db, 'pry_a', ['cli_a']);
    await seedProject(host.db, 'pry_b', ['cli_a']);
  });
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const installment = (id: string, over: Partial<NewInstallment> = {}): NewInstallment => ({
  id,
  projectId: 'pry_a',
  billingPlanId: null,
  recurringChargeId: null,
  kind: 'CUOTA',
  label: id,
  amount: '100.00',
  currency: 'USD',
  percentage: null,
  dueDate: null,
  trigger: null,
  periodStart: null,
  periodEnd: null,
  order: 0,
  ...over,
});

const invoiceOn = (id: string, installmentId: string, over: object = {}) =>
  seedInvoice(host.db, {
    id,
    clientId: 'cli_a',
    lines: [
      { id: `${id}_l`, projectId: 'pry_a', unitPrice: '40.00', ivaRate: null, installmentId },
    ],
    ...over,
  });

const charge = {
  id: 'rch_a',
  projectId: 'pry_a',
  label: 'Soporte',
  amount: '300.00',
  currency: 'USD',
  frequency: 'TRIMESTRAL' as const,
  startDate: '2026-11-01',
  endDate: null,
  billingDay: 5,
  leadDays: 7,
  status: 'ACTIVO' as const,
  lastGeneratedPeriodStart: null,
  resumedOn: null,
  usdRate: '1',
  monthlyAmountUsd: '100.00',
};

describe('plans', () => {
  it('saves and updates the plan with its snapshot, as decimal strings', async () => {
    await uow.run(async () => {
      const saved = await repository.savePlan(
        {
          id: 'bpl_a',
          projectId: 'pry_a',
          model: 'PRECIO_FIJO',
          currency: 'USD',
          contractAmount: '10000.00',
          contractedUsd: '10000.00',
          usdRate: '1',
          notes: null,
        },
        AT,
      );
      expect(saved).toMatchObject({
        contractAmount: '10000.00',
        contractedUsd: '10000.00',
        usdRate: '1',
      });
      const updated = await repository.savePlan(
        { ...saved, notes: 'n', contractAmount: null, contractedUsd: null },
        AT,
      );
      expect(updated).toMatchObject({
        id: 'bpl_a',
        notes: 'n',
        contractAmount: null,
        createdAt: saved.createdAt,
      });
      expect(await repository.findPlan('pry_a')).toEqual(updated);
      expect(await repository.findPlan('pry_b')).toBeNull();
    });
  });
});

describe('installments', () => {
  it('lists by order, derives locked and invoicedAmount from live invoices only', async () => {
    await uow.run(async () => {
      await repository.insertInstallments([
        installment('ins_1', { order: 2 }),
        installment('ins_2', { order: 1 }),
        installment('ins_3', {
          order: 3,
          amount: '-20.00',
          kind: 'AJUSTE',
          percentage: '12.50',
          dueDate: '2026-12-01',
        }),
      ]);
      await invoiceOn('inv_live', 'ins_1');
      await invoiceOn('inv_void', 'ins_2', { status: 'ANULADA' });
      await invoiceOn('inv_arch', 'ins_3', { archived: true });
    });
    const rows = await repository.listInstallments('pry_a');
    expect(rows.map((row) => [row.id, row.locked, row.invoicedAmount])).toEqual([
      ['ins_2', false, '0.00'],
      ['ins_1', true, '40.00'],
      ['ins_3', false, '0.00'],
    ]);
    expect(rows[2]).toMatchObject({
      amount: '-20.00',
      percentage: '12.5',
      dueDate: '2026-12-01',
      kind: 'AJUSTE',
    });
    expect(await repository.findInstallment('ins_1')).toMatchObject({ locked: true });
    expect(await repository.findInstallment('nope')).toBeNull();
    expect(await repository.maxInstallmentOrder('pry_a')).toBe(3);
    expect(await repository.maxInstallmentOrder('pry_b')).toBe(-1);
  });

  it('updates only the named fields, cancels and sets the status', async () => {
    await uow.run(async () => {
      await repository.insertInstallments([
        installment('ins_1', { percentage: '40', trigger: 't' }),
      ]);
      await repository.updateInstallment(
        'ins_1',
        { label: 'Nuevo', amount: '55.50', dueDate: '2026-12-31', percentage: null },
        AT,
      );
      await repository.setInstallmentStatus('ins_1', 'FACTURADA');
      expect(await repository.findInstallment('ins_1')).toMatchObject({
        label: 'Nuevo',
        amount: '55.50',
        dueDate: '2026-12-31',
        percentage: null,
        trigger: 't',
        status: 'FACTURADA',
      });
      await repository.cancelInstallments(['ins_1'], AT);
      await repository.cancelInstallments([], AT);
      expect(await repository.findInstallment('ins_1')).toMatchObject({
        status: 'CANCELADA',
        cancelledAt: AT.toISOString(),
      });
    });
  });

  it('reports the invoices that reference an installment, archived ones excluded', async () => {
    await uow.run(async () => {
      await repository.insertInstallments([installment('ins_1')]);
      await invoiceOn('inv_a', 'ins_1');
      await invoiceOn('inv_b', 'ins_1', { status: 'PAGADA' });
      await invoiceOn('inv_c', 'ins_1', { archived: true });
    });
    const [state] = await repository.installmentInvoiceStates(['ins_1', 'missing']);
    expect(state?.cancelled).toBe(false);
    expect(state?.invoices.map((invoice) => invoice.status).sort()).toEqual(['EMITIDA', 'PAGADA']);
  });

  it('inserts generated installments skipping a period that already exists', async () => {
    await uow.run(async () => {
      await repository.insertCharge(charge, AT);
      const row = (id: string, periodStart: string) =>
        installment(id, {
          kind: 'RECURRENTE',
          recurringChargeId: 'rch_a',
          periodStart,
          periodEnd: periodStart,
        });
      expect(await repository.insertGeneratedInstallments([])).toEqual([]);
      expect(
        await repository.insertGeneratedInstallments([
          row('ins_1', '2026-11-05'),
          row('ins_2', '2027-02-05'),
        ]),
      ).toEqual(['2026-11-05', '2027-02-05']);
      expect(
        await repository.insertGeneratedInstallments([
          row('ins_3', '2026-11-05'),
          row('ins_4', '2027-05-05'),
        ]),
      ).toEqual(['2027-05-05']);
      expect(await repository.periodStartsOf('rch_a')).toEqual([
        '2026-11-05',
        '2027-02-05',
        '2027-05-05',
      ]);
    });
  });
});

describe('recurring charges', () => {
  it('round-trips a charge and applies partial updates', async () => {
    await uow.run(async () => {
      await repository.insertCharge(charge, AT);
      expect(await repository.findCharge('rch_a')).toMatchObject({
        amount: '300.00',
        usdRate: '1',
        monthlyAmountUsd: '100.00',
        endDate: null,
        resumedOn: null,
        startDate: '2026-11-01',
      });
      await repository.updateCharge(
        'rch_a',
        {
          label: 'Otro',
          amount: '600.00',
          currency: 'USD',
          frequency: 'SEMESTRAL',
          startDate: '2026-12-01',
          endDate: '2027-12-31',
          billingDay: 10,
          leadDays: 3,
          status: 'PAUSADO',
          lastGeneratedPeriodStart: '2026-12-10',
          resumedOn: '2027-01-01',
          usdRate: '0.5',
          monthlyAmountUsd: '200.00',
        },
        AT,
      );
      expect(await repository.findCharge('rch_a')).toMatchObject({
        label: 'Otro',
        amount: '600.00',
        frequency: 'SEMESTRAL',
        startDate: '2026-12-01',
        endDate: '2027-12-31',
        billingDay: 10,
        leadDays: 3,
        status: 'PAUSADO',
        lastGeneratedPeriodStart: '2026-12-10',
        resumedOn: '2027-01-01',
        usdRate: '0.5',
        monthlyAmountUsd: '200.00',
      });
      await repository.updateCharge('rch_a', { endDate: null, status: 'ACTIVO' }, AT);
      expect(await repository.findCharge('rch_a')).toMatchObject({
        endDate: null,
        status: 'ACTIVO',
      });
      expect((await repository.listCharges('pry_a')).map((row) => row.id)).toEqual(['rch_a']);
      expect(await repository.listCharges('pry_b')).toEqual([]);
      expect(await repository.activeChargeIds()).toEqual(['rch_a']);
      await repository.updateCharge('rch_a', { status: 'FINALIZADO' }, AT);
      expect(await repository.activeChargeIds()).toEqual([]);
    });
  });
});

describe('what the project still has', () => {
  it('hasActiveBilling counts open installments, live charges and issued invoices', async () => {
    expect(await repository.hasActiveBilling('pry_a')).toBe(false);
    await uow.run(() => repository.insertInstallments([installment('ins_1')]));
    expect(await repository.hasActiveBilling('pry_a')).toBe(true);
    await uow.run(async () => {
      await repository.setInstallmentStatus('ins_1', 'COBRADA');
    });
    expect(await repository.hasActiveBilling('pry_a')).toBe(false);

    await uow.run(() => repository.insertCharge(charge, AT));
    expect(await repository.hasActiveBilling('pry_a')).toBe(true);
    expect(await repository.hasActiveCharge('pry_a')).toBe(true);
    await uow.run(() => repository.updateCharge('rch_a', { status: 'FINALIZADO' }, AT));
    expect(await repository.hasActiveCharge('pry_a')).toBe(false);
    expect(await repository.hasActiveBilling('pry_a')).toBe(false);

    await uow.run(() => invoiceOn('inv_draft', 'ins_1', { status: 'BORRADOR' }));
    expect(await repository.hasActiveBilling('pry_a')).toBe(false);
    await uow.run(() => invoiceOn('inv_issued', 'ins_1'));
    expect(await repository.hasActiveBilling('pry_a')).toBe(true);
    expect(await repository.hasActiveBilling('pry_b')).toBe(false);
  });

  it('names the plan, installment and charge ids of a project', async () => {
    await uow.run(async () => {
      await repository.savePlan(
        {
          id: 'bpl_a',
          projectId: 'pry_a',
          model: 'RECURRENTE',
          currency: 'USD',
          contractAmount: null,
          contractedUsd: null,
          usdRate: null,
          notes: null,
        },
        AT,
      );
      await repository.insertInstallments([installment('ins_1')]);
      await repository.insertCharge(charge, AT);
    });
    expect(await repository.billingIdsOf('pry_a')).toEqual({
      billingPlanIds: ['bpl_a'],
      installmentIds: ['ins_1'],
      recurringChargeIds: ['rch_a'],
    });
    expect(await repository.billingIdsOf('pry_b')).toEqual({
      billingPlanIds: [],
      installmentIds: [],
      recurringChargeIds: [],
    });
  });
});
