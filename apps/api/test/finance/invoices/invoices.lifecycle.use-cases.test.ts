import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import { ConflictError } from '../../../src/shared/domain/domain-error';
import {
  CANCELLED,
  KAIROS,
  NOW,
  SEED_LINE,
  WEB,
  WEB_1,
  createWorld,
  invoiceRecord,
  rejection,
} from './world';

const billing = (installmentId: string, netAmount: string, projectId: string | null = WEB) => ({
  ...SEED_LINE,
  id: `inl_${installmentId}_${netAmount}`,
  projectId,
  installmentId,
  unitPrice: netAmount,
  amount: netAmount,
  netAmount,
});

describe('restore from the trash (Q-BE3-4, HU-28 CA2)', () => {
  const archived = (over: Parameters<typeof invoiceRecord>[0] = {}) =>
    invoiceRecord({ id: 'inv_arch', archivedAt: NOW, archivedById: 'usr_owner', ...over });

  it('brings the invoice back: facts, search entry, installments and a RESTORE entry', async () => {
    const w = createWorld();
    w.invoices.seed(archived({ lines: [billing(WEB_1, '100.00')] }));
    const restored = await w.restore.execute(w.owner, 'inv_arch');

    expect(restored.entity).toEqual({
      type: 'INVOICE',
      id: 'inv_arch',
      code: 'FAC-0100',
      label: 'KAI-0001',
    });
    expect(restored.restoredAt.toISOString()).toBe(NOW);
    expect((await w.invoices.findById('inv_arch'))?.archivedAt).toBeNull();
    expect(w.search.get('INVOICE', 'inv_arch')).toMatchObject({
      archived: false,
      status: 'EMITIDA',
    });
    expect(w.recomputed).toEqual([[WEB_1]]);
    expect(w.projector.calls).toEqual(['invoice:inv_arch', `clients:${KAIROS}`, `projects:${WEB}`]);
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'RESTORE',
      entityId: 'inv_arch',
      clientId: KAIROS,
    });
    expect(w.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('an invoice that is not in the trash is NOT_FOUND', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_live' }));
    expect(await rejection(w.restore.execute(w.owner, 'inv_live'))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await rejection(w.restore.execute(w.owner, 'inv_missing'))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses while another live invoice holds the number: CONFLICT pointing at the holder', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_holder', invoiceNumber: 'kai-0001' }));
    w.invoices.seed(archived());
    expect(await rejection(w.restore.execute(w.owner, 'inv_arch'))).toMatchObject({
      code: 'CONFLICT',
      message: 'trash.errors.invoiceNumberTaken',
      entity: { type: 'INVOICE', id: 'inv_holder' },
    });
    expect((await w.invoices.findById('inv_arch'))?.archivedAt).toBe(NOW);
  });

  it('refuses while its client is archived: CONFLICT pointing at the client', async () => {
    const w = createWorld();
    w.invoices.seed(archived({ clientId: 'cli_gone' }));
    expect(await rejection(w.restore.execute(w.owner, 'inv_arch'))).toMatchObject({
      code: 'CONFLICT',
      message: 'trash.errors.clientArchived',
      entity: { type: 'CLIENT', id: 'cli_gone' },
    });
  });

  it('refuses when restoring would over-bill an installment: CONFLICT installmentExceeded', async () => {
    const w = createWorld();
    w.invoices.seed(archived({ lines: [billing(WEB_1, '4000.00')] }));
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_other',
        invoiceNumber: 'KAI-0002',
        lines: [billing(WEB_1, '1.00')],
      }),
    );
    expect(await rejection(w.restore.execute(w.owner, 'inv_arch'))).toMatchObject({
      code: 'CONFLICT',
      message: 'invoices.errors.installmentExceeded',
    });
    expect((await w.invoices.findById('inv_arch'))?.archivedAt).toBe(NOW);
  });

  it('an over-billing check ignores voided and archived invoices, and restores when it fits', async () => {
    const w = createWorld();
    w.invoices.seed(archived({ lines: [billing(WEB_1, '4000.00')] }));
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_void',
        invoiceNumber: 'V',
        status: 'ANULADA',
        voidedAt: NOW,
        lines: [billing(WEB_1, '500.00')],
      }),
    );
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_old',
        invoiceNumber: 'O',
        archivedAt: NOW,
        lines: [billing(WEB_1, '500.00')],
      }),
    );
    await w.restore.execute(w.owner, 'inv_arch');
    expect((await w.invoices.findById('inv_arch'))?.archivedAt).toBeNull();
  });

  it('refuses when a billed installment was cancelled meanwhile', async () => {
    const w = createWorld();
    w.invoices.seed(archived({ lines: [billing(CANCELLED, '100.00')] }));
    expect(await rejection(w.restore.execute(w.owner, 'inv_arch'))).toMatchObject({
      code: 'CONFLICT',
      message: 'invoices.errors.installmentCancelled',
    });
  });
});

describe('MarkOverdueInvoices (HU-12 CA4, daily-maintenance step)', () => {
  it('turns every EMITIDA and PARCIAL invoice past its due date into VENCIDA and projects its client and projects', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_a',
        invoiceNumber: 'A',
        dueDate: '2026-10-08',
        lines: [billing(WEB_1, '100.00')],
      }),
    );
    w.invoices.seed(
      invoiceRecord({ id: 'inv_b', invoiceNumber: 'B', dueDate: '2026-09-01', status: 'PARCIAL' }),
    );
    w.invoices.seed(invoiceRecord({ id: 'inv_c', invoiceNumber: 'C', dueDate: '2026-10-09' }));
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_d',
        invoiceNumber: 'D',
        dueDate: '2026-01-01',
        isDraft: true,
        status: 'BORRADOR',
      }),
    );

    const result = await w.markOverdue.execute(SYSTEM_ACTOR);

    expect(result).toEqual({
      updated: 2,
      invoiceIds: ['inv_a', 'inv_b'],
      skippedIds: [],
    });
    expect((await w.invoices.findById('inv_a'))?.status).toBe('VENCIDA');
    expect((await w.invoices.findById('inv_b'))?.status).toBe('VENCIDA');
    expect((await w.invoices.findById('inv_c'))?.status).toBe('EMITIDA');
    expect((await w.invoices.findById('inv_d'))?.status).toBe('BORRADOR');
    expect(w.projector.calls).toEqual([
      'invoice:inv_a',
      `clients:${KAIROS}`,
      `projects:${WEB}`,
      'invoice:inv_b',
      `clients:${KAIROS}`,
    ]);
    expect(
      w.activity.entries.map((entry) => [entry.action, entry.entityId, entry.actor.actorType]),
    ).toEqual([
      ['SYSTEM_JOB', 'inv_a', 'SYSTEM'],
      ['SYSTEM_JOB', 'inv_b', 'SYSTEM'],
    ]);
  });

  it('is idempotent: the second run changes nothing', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', invoiceNumber: 'A', dueDate: '2026-10-08' }));
    await w.markOverdue.execute(SYSTEM_ACTOR);
    const calls = w.projector.calls.length;
    expect(await w.markOverdue.execute(SYSTEM_ACTOR)).toEqual({
      updated: 0,
      invoiceIds: [],
      skippedIds: [],
    });
    expect(w.projector.calls).toHaveLength(calls);
    expect(w.activity.entries).toHaveLength(1);
  });

  it('a CONFLICT on one invoice skips it, the rest of the run goes on and the next run picks it up', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', invoiceNumber: 'A', dueDate: '2026-10-08' }));
    w.invoices.seed(invoiceRecord({ id: 'inv_b', invoiceNumber: 'B', dueDate: '2026-10-08' }));
    const update = w.invoices.update.bind(w.invoices);
    w.invoices.update = async (record) => {
      if (record.id === 'inv_a') throw new ConflictError();
      return update(record);
    };

    expect(await w.markOverdue.execute(SYSTEM_ACTOR)).toEqual({
      updated: 1,
      invoiceIds: ['inv_b'],
      skippedIds: ['inv_a'],
    });
    expect((await w.invoices.findById('inv_a'))?.status).toBe('EMITIDA');
    expect((await w.invoices.findById('inv_b'))?.status).toBe('VENCIDA');

    w.invoices.update = update;
    expect(await w.markOverdue.execute(SYSTEM_ACTOR)).toEqual({
      updated: 1,
      invoiceIds: ['inv_a'],
      skippedIds: [],
    });
  });

  it('any other error still aborts the run', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', invoiceNumber: 'A', dueDate: '2026-10-08' }));
    w.invoices.update = async () => {
      throw new Error('disk full');
    };
    await expect(w.markOverdue.execute(SYSTEM_ACTOR)).rejects.toThrow('disk full');
  });

  it('only a SYSTEM actor may run it', async () => {
    const w = createWorld();
    expect(
      await rejection(w.markOverdue.execute({ actorType: 'USER', userId: 'usr_owner' })),
    ).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('recomputes the status instead of forcing VENCIDA: a fully paid invoice becomes PAGADA', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', invoiceNumber: 'A', dueDate: '2026-10-08' }));
    w.invoices.seedAllocation('inv_a', {
      paymentId: 'pay_a',
      amountInvoiceCurrency: '116.00',
      paymentStatus: 'CONFIRMADO',
    });
    const result = await w.markOverdue.execute(SYSTEM_ACTOR);
    expect(result.updated).toBe(1);
    // Fully paid: the recomputed status is PAGADA, never VENCIDA.
    expect((await w.invoices.findById('inv_a'))?.status).toBe('PAGADA');
  });
});

describe('RecomputeInvoice (C17, data-rules §8)', () => {
  const adjusted = (over: Parameters<typeof invoiceRecord>[0] = {}) =>
    invoiceRecord({
      id: 'inv_adj',
      ivaAmount: '16.01',
      total: '116.01',
      receivable: '116.01',
      totalUsd: '116.01',
      receivableUsd: '116.01',
      balance: '116.01',
      taxLines: [{ ivaRate: '16', taxBase: '100.00', ivaAmount: '16.01' }],
      ...over,
    });

  it('keeps a valid +0.01 adjustment while the tax base and the rate are unchanged', async () => {
    const w = createWorld();
    w.invoices.seed(adjusted());
    w.invoices.seedAllocation('inv_adj', {
      paymentId: 'pay_a',
      amountInvoiceCurrency: '16.01',
      paymentStatus: 'CONFIRMADO',
    });
    const record = await w.uow.run(() => w.recompute.execute('inv_adj'));
    expect(record).toMatchObject({
      total: '116.01',
      ivaAmount: '16.01',
      paidAmount: '16.01',
      balance: '100.00',
      status: 'PARCIAL',
    });
    expect(record.taxLines).toEqual([{ ivaRate: '16', taxBase: '100.00', ivaAmount: '16.01' }]);
  });

  it('resets the adjustment when the tax base changed', async () => {
    const w = createWorld();
    w.invoices.seed(
      adjusted({ taxLines: [{ ivaRate: '16', taxBase: '90.00', ivaAmount: '14.41' }] }),
    );
    const record = await w.uow.run(() => w.recompute.execute('inv_adj'));
    expect(record).toMatchObject({ total: '116.00', ivaAmount: '16.00' });
    expect(record.taxLines).toEqual([{ ivaRate: '16', taxBase: '100.00', ivaAmount: '16.00' }]);
  });

  it('an adjustment on a rate whose stored base changed is reset, an out-of-range one is dropped', async () => {
    const w = createWorld();
    w.invoices.seed(
      adjusted({ taxLines: [{ ivaRate: '16', taxBase: '100.00', ivaAmount: '16.50' }] }),
    );
    const record = await w.uow.run(() => w.recompute.execute('inv_adj'));
    expect(record.ivaAmount).toBe('16.00');
  });

  it('a voided invoice stays ANULADA and a draft stays BORRADOR whatever its payments', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({ id: 'inv_v', invoiceNumber: 'V', status: 'ANULADA', voidedAt: NOW }),
    );
    w.invoices.seed(
      invoiceRecord({ id: 'inv_d', invoiceNumber: 'D', isDraft: true, status: 'BORRADOR' }),
    );
    expect((await w.uow.run(() => w.recompute.execute('inv_v'))).status).toBe('ANULADA');
    expect((await w.uow.run(() => w.recompute.execute('inv_d'))).status).toBe('BORRADOR');
  });

  it('an unknown invoice is NOT_FOUND', async () => {
    const w = createWorld();
    expect(await rejection(w.uow.run(() => w.recompute.execute('inv_missing')))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
