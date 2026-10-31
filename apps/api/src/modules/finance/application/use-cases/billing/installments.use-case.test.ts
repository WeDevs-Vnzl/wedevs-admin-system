import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT,
  createWorld,
  rejection,
  type World,
} from '../../../../../../test/finance/billing/world';

let world: World;

async function billedInstallment() {
  await world.upsertPlan.execute(world.owner, {
    projectId: PROJECT,
    model: 'PRECIO_FIJO',
    currency: 'USD',
    contractAmount: '10000',
  });
  const page = await world.createInstallment.execute(world.owner, {
    projectId: PROJECT,
    kind: 'ANTICIPO',
    label: 'Anticipo',
    amount: '4000',
    currency: 'USD',
  });
  const installmentId = page.installments[0]?.id as string;
  world.repository.bill(installmentId, '4000.00');
  return installmentId;
}

const update = (id: string, change: object) =>
  world.updateInstallment.execute(world.owner, { id, ...change });

beforeEach(() => {
  world = createWorld();
});

describe('billed installments are locked (HU-09 CA3)', () => {
  it.each([
    { amount: '4500' },
    { currency: 'EUR' },
    { percentage: '45' },
    { dueDate: '2026-12-01' },
    { trigger: 'Entrega final' },
    { order: 7 },
  ])('a billed installment refuses %j with INTEGRITY_LOCK', async (change) => {
    const id = await billedInstallment();
    const error = await rejection(update(id, change));
    expect(error).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'billing.errors.installmentBilled',
    });
    expect(world.repository.installments.find((item) => item.id === id)).toMatchObject({
      amount: '4000.00',
      currency: 'USD',
    });
  });

  it('the label of a billed installment can still change, and the same values are not a change', async () => {
    const id = await billedInstallment();
    const page = await update(id, {
      label: 'Anticipo firmado',
      amount: '4000.00',
      currency: 'USD',
    });
    expect(page.installments[0]).toMatchObject({ label: 'Anticipo firmado', locked: true });
  });

  it('a voided invoice releases the lock', async () => {
    const id = await billedInstallment();
    world.repository.release(id);
    const page = await update(id, { amount: '4500' });
    expect(page.installments[0]).toMatchObject({ amount: '4500.00', locked: false });
  });

  it('a billed installment cannot be cancelled; a pending one can', async () => {
    const id = await billedInstallment();
    expect((await rejection(world.cancelInstallment.execute(world.owner, id))).code).toBe(
      'INTEGRITY_LOCK',
    );
    const pending = await world.createInstallment.execute(world.owner, {
      projectId: PROJECT,
      kind: 'CUOTA',
      label: 'Pendiente',
      amount: '100',
      currency: 'USD',
    });
    const pendingId = pending.installments.find((item) => item.label === 'Pendiente')?.id as string;
    const cancelled = await world.cancelInstallment.execute(world.owner, pendingId);
    const row = cancelled.installments.find((item) => item.id === pendingId);
    expect(row?.status).toBe('CANCELADA');
    expect(row?.cancelledAt).not.toBeNull();
  });

  it('locks the installment row before it reads it, after project and clients', async () => {
    const id = await billedInstallment();
    world.repository.release(id);
    await update(id, { label: 'x' });
    expect(world.locks.acquired.map((lock) => lock.rowClass)).toEqual([
      'Project',
      'Client',
      'BillingInstallment',
    ]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });
});

describe('editing and cancelling', () => {
  it('a cancelled installment is read-only and cannot be cancelled again (CONFLICT)', async () => {
    const id = await billedInstallment();
    world.repository.release(id);
    await world.cancelInstallment.execute(world.owner, id);
    for (const run of [
      () => update(id, { label: 'x' }),
      () => world.cancelInstallment.execute(world.owner, id),
    ]) {
      expect(await rejection(run())).toMatchObject({
        code: 'CONFLICT',
        message: 'billing.errors.installmentCancelled',
      });
    }
  });

  it('an unknown installment is NOT_FOUND, also when its project was archived', async () => {
    expect((await rejection(update('ins_missing', { label: 'x' }))).code).toBe('NOT_FOUND');
    const id = await billedInstallment();
    world.repository.release(id);
    world.projects.live.delete(PROJECT);
    expect((await rejection(update(id, { label: 'x' }))).code).toBe('NOT_FOUND');
    expect((await rejection(world.cancelInstallment.execute(world.owner, id))).code).toBe(
      'NOT_FOUND',
    );
  });

  it('refuses an empty edit and bad values without a DTO', async () => {
    const id = await billedInstallment();
    world.repository.release(id);
    expect((await rejection(update(id, {}))).fieldErrors?._form).toEqual([
      'billing.validation.nothingToUpdate',
    ]);
    expect((await rejection(update(id, { amount: '0' }))).fieldErrors?.amount).toEqual([
      'validation.money.mustBePositive',
    ]);
    expect((await rejection(update(id, { amount: '-1' }))).fieldErrors?.amount).toEqual([
      'validation.money.mustBePositive',
    ]);
    expect((await rejection(update(id, { amount: '1.234' }))).fieldErrors?.amount).toEqual([
      'validation.money.invalid',
    ]);
    expect((await rejection(update(id, { label: ' ' }))).fieldErrors?.label).toEqual([
      'validation.required',
    ]);
    expect((await rejection(update(id, { currency: 'ZZZ' }))).fieldErrors?.currency).toEqual([
      'validation.currency.invalid',
    ]);
    expect(
      (await rejection(update(id, { percentage: '101' }))).fieldErrors?.percentage,
    ).toBeDefined();
    expect(
      (await rejection(update(id, { dueDate: '2026-02-30' }))).fieldErrors?.dueDate,
    ).toBeDefined();
    expect((await rejection(update(id, { order: -1 }))).fieldErrors?.order).toBeDefined();
  });

  it('an AJUSTE may be negative but never zero', async () => {
    await world.upsertPlan.execute(world.owner, {
      projectId: PROJECT,
      model: 'PRECIO_FIJO',
      currency: 'USD',
      contractAmount: '100',
    });
    const page = await world.createInstallment.execute(world.owner, {
      projectId: PROJECT,
      kind: 'AJUSTE',
      label: 'Ajuste',
      amount: '-20',
      currency: 'USD',
    });
    const id = page.installments[0]?.id as string;
    expect((await update(id, { amount: '-30' })).installments[0]?.amount).toBe('-30.00');
    expect((await rejection(update(id, { amount: '0' }))).fieldErrors?.amount).toEqual([
      'billing.validation.adjustmentNonZero',
    ]);
  });

  it('clears the optional fields with null', async () => {
    const id = await billedInstallment();
    world.repository.release(id);
    await update(id, { percentage: '40', dueDate: '2026-12-01', trigger: 'Hito' });
    const page = await update(id, { percentage: null, dueDate: null, trigger: null });
    expect(page.installments[0]).toMatchObject({ percentage: null, dueDate: null, trigger: null });
    // Clearing what is already empty is not a change, so even a billed installment accepts it.
    world.repository.bill(id, '4000.00');
    await expect(update(id, { percentage: null })).resolves.toBeDefined();
  });

  it('a manual installment cannot be RECURRENTE, needs a plan and a known currency', async () => {
    const draft = {
      projectId: PROJECT,
      kind: 'CUOTA' as const,
      label: 'x',
      amount: '10',
      currency: 'USD',
    };
    expect(
      (await rejection(world.createInstallment.execute(world.owner, draft))).fieldErrors?.projectId,
    ).toEqual(['billing.errors.planRequired']);
    await world.upsertPlan.execute(world.owner, {
      projectId: PROJECT,
      model: 'PRECIO_FIJO',
      currency: 'USD',
      contractAmount: '100',
    });
    expect(
      (
        await rejection(
          world.createInstallment.execute(world.owner, { ...draft, kind: 'RECURRENTE' }),
        )
      ).fieldErrors?.kind,
    ).toEqual(['billing.validation.installmentKindNotManual']);
    expect(
      (await rejection(world.createInstallment.execute(world.owner, { ...draft, currency: 'ZZZ' })))
        .fieldErrors?.currency,
    ).toEqual(['validation.currency.invalid']);
    expect(
      (await rejection(world.createInstallment.execute(world.owner, { ...draft, order: 1000 })))
        .fieldErrors?.order,
    ).toBeDefined();
  });

  it('Member and Viewer are FORBIDDEN on every installment route', async () => {
    const id = await billedInstallment();
    for (const user of [world.member, world.viewer]) {
      expect(
        (await rejection(world.updateInstallment.execute(user, { id, label: 'x' }))).code,
      ).toBe('FORBIDDEN');
      expect((await rejection(world.cancelInstallment.execute(user, id))).code).toBe('FORBIDDEN');
      expect(
        (
          await rejection(
            world.createInstallment.execute(user, {
              projectId: PROJECT,
              kind: 'HITO',
              label: 'x',
              amount: '1',
              currency: 'USD',
            }),
          )
        ).code,
      ).toBe('FORBIDDEN');
    }
  });
});

describe('recomputeInstallmentStatus (PRD §12)', () => {
  it('derives the status from the invoices that reference the installment', async () => {
    const id = await billedInstallment();
    expect(await world.recomputeStatus.execute([id])).toEqual([id]);
    expect(world.repository.installments.find((item) => item.id === id)?.status).toBe('FACTURADA');

    world.repository.bill(id, '0.00', { status: 'PARCIAL', paidAmount: '10.00' });
    await world.recomputeStatus.execute([id]);
    expect(world.repository.installments.find((item) => item.id === id)?.status).toBe(
      'COBRADA_PARCIAL',
    );
  });

  it('paid invoices make it COBRADA, voided ones release it, a cancelled one stays CANCELADA', async () => {
    const id = await billedInstallment();
    world.repository.release(id);
    world.repository.bill(id, '4000.00', { status: 'PAGADA', paidAmount: '4000.00' });
    await world.recomputeStatus.execute([id]);
    expect(world.repository.installments.find((item) => item.id === id)?.status).toBe('COBRADA');

    world.repository.release(id);
    world.repository.bill(id, '0.00', { status: 'ANULADA', paidAmount: '0.00' });
    await world.recomputeStatus.execute([id]);
    expect(world.repository.installments.find((item) => item.id === id)?.status).toBe('PENDIENTE');

    await world.repository.cancelInstallments([id], new Date());
    expect(await world.recomputeStatus.execute([id])).toEqual([]);
  });

  it('changes nothing for no ids, duplicated ids or an unchanged status', async () => {
    expect(await world.recomputeStatus.execute([])).toEqual([]);
    const id = await billedInstallment();
    await world.recomputeStatus.execute([id, id]);
    expect(await world.recomputeStatus.execute([id])).toEqual([]);
  });
});
