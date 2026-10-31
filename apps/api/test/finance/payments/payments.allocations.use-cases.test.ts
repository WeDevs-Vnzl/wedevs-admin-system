import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACC_USD,
  ACC_VES,
  KAIROS,
  WEB,
  ZAFIRO,
  createPaymentsWorld,
  paymentInput,
  rejection,
  type PaymentsWorld,
} from './world';

let world: PaymentsWorld;
beforeEach(() => {
  world = createPaymentsWorld();
});

const draft = (paymentId: string, invoiceId: string, payment: string, invoice = payment) => ({
  paymentId,
  invoiceId,
  amountPaymentCurrency: payment,
  amountInvoiceCurrency: invoice,
});

/** A confirmed 300 USD payment with nothing applied. */
const credit300 = () => world.create.execute(world.owner, paymentInput({ amount: '300.00' }));

describe('allocatePayment: HU-13 CA3 a further amount of a confirmed payment', () => {
  it('applies the amount, recomputes the invoice and the payment credit, and logs ALLOCATE', async () => {
    world.addInvoice('inv_later', '400.00', { projectId: WEB });
    const payment = await credit300();
    world.projector.calls.length = 0;

    const allocation = await world.allocate.execute(
      world.owner,
      draft(payment.id, 'inv_later', '120.00'),
    );

    expect(allocation).toMatchObject({
      paymentId: payment.id,
      invoice: { type: 'INVOICE', id: 'inv_later', code: 'FAC-T-inv_later' },
      invoiceCurrency: 'USD',
      amountPaymentCurrency: '120.00',
      amountInvoiceCurrency: '120.00',
      amountUsd: '120.00',
    });
    expect(await world.get.execute(world.owner, payment.id)).toMatchObject({
      allocated: '120.00',
      unallocated: '180.00',
    });
    expect(await world.invoices.findById('inv_later')).toMatchObject({
      paidAmount: '120.00',
      balance: '280.00',
      status: 'PARCIAL',
    });
    expect(world.projector.calls).toEqual([
      `payment:${payment.id}`,
      `account:${ACC_USD}`,
      `clients:${KAIROS}`,
      `projects:${WEB}`,
    ]);
    expect(world.search.get('INVOICE', 'inv_later')).toMatchObject({ status: 'PARCIAL' });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    const entry = world.activity.entries.at(-1);
    expect(entry).toMatchObject({
      action: 'ALLOCATE',
      entityType: 'PAYMENT',
      entityId: payment.id,
      metadata: { code: 'PAG-0001', invoiceId: 'inv_later', allocationId: allocation.id },
    });
  });

  it('locks payment, invoice and account together, in the global order', async () => {
    world.addInvoice('inv_l', '100.00', { projectId: WEB });
    const payment = await credit300();
    await world.allocate.execute(world.owner, draft(payment.id, 'inv_l', '10.00'));
    expect(world.locks.acquired).toEqual([
      { rowClass: 'Project', id: WEB },
      { rowClass: 'Client', id: KAIROS },
      { rowClass: 'Invoice', id: 'inv_l' },
      { rowClass: 'Payment', id: payment.id },
      { rowClass: 'Account', id: ACC_USD },
    ]);
  });

  it('refuses a payment that is not confirmed', async () => {
    world.addInvoice('inv_pending', '100.00');
    const payment = await world.create.execute(
      world.owner,
      paymentInput({ status: 'PENDIENTE_VERIFICACION' }),
    );
    const error = await rejection(
      world.allocate.execute(world.owner, draft(payment.id, 'inv_pending', '10.00')),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { paymentId: ['payments.validation.paymentNotConfirmed'] },
    });
  });

  it('counts what is already applied against the allocatable amount', async () => {
    world.addInvoice('inv_x', '500.00');
    world.addInvoice('inv_y', '500.00');
    const payment = await credit300();
    await world.allocate.execute(world.owner, draft(payment.id, 'inv_x', '250.00'));
    const error = await rejection(
      world.allocate.execute(world.owner, draft(payment.id, 'inv_y', '60.00')),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { allocations: ['payments.validation.allocationsExceedAllocatable'] },
    });
    expect(world.payments.allAllocations).toHaveLength(1);
  });

  it('refuses more than the invoice balance, another client invoice and a voided one', async () => {
    world.addInvoice('inv_small', '50.00');
    world.addInvoice('inv_other', '100.00', { clientId: ZAFIRO });
    world.addInvoice('inv_void', '100.00', {
      voidedAt: '2026-10-01T10:00:00.000Z',
      status: 'ANULADA',
    });
    const payment = await credit300();
    const over = await rejection(
      world.allocate.execute(world.owner, draft(payment.id, 'inv_small', '60.00')),
    );
    expect(over.fieldErrors).toEqual({
      'allocations.0.amountInvoiceCurrency': ['payments.validation.allocationExceedsBalance'],
    });
    for (const id of ['inv_other', 'inv_void']) {
      const error = await rejection(
        world.allocate.execute(world.owner, draft(payment.id, id, '10.00')),
      );
      expect(error.fieldErrors).toEqual({
        'allocations.0.invoiceId': ['payments.validation.allocationInvoiceNotOpen'],
      });
    }
    expect(world.payments.allAllocations).toHaveLength(0);
  });

  it('a second live allocation to the same invoice is a CONFLICT (allocation_unique_active)', async () => {
    world.addInvoice('inv_twice', '300.00');
    const payment = await credit300();
    await world.allocate.execute(world.owner, draft(payment.id, 'inv_twice', '50.00'));
    const error = await rejection(
      world.allocate.execute(world.owner, draft(payment.id, 'inv_twice', '50.00')),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      fieldErrors: {
        'allocations.0.invoiceId': ['payments.validation.duplicateInvoiceAllocation'],
      },
    });
    expect(world.payments.allAllocations).toHaveLength(1);
  });

  it('a VES payment on a USD invoice stores the USD snapshot at the payment rate', async () => {
    world.addInvoice('inv_usd', '1000.00');
    const payment = await world.create.execute(
      world.owner,
      paymentInput({ accountId: ACC_VES, currency: 'VES', amount: '36500.00', usdRate: '36.50' }),
    );
    const allocation = await world.allocate.execute(
      world.owner,
      draft(payment.id, 'inv_usd', '18250.00', '500.00'),
    );
    expect(allocation).toMatchObject({ amountUsd: '500.00', amountInvoiceCurrency: '500.00' });
    expect(await world.invoices.findById('inv_usd')).toMatchObject({ balance: '500.00' });
  });

  it('answers NOT_FOUND for an unknown payment or invoice and enforces the amount rules itself', async () => {
    world.addInvoice('inv_ok', '100.00');
    const payment = await credit300();
    expect(
      (await rejection(world.allocate.execute(world.owner, draft('pay_missing', 'inv_ok', '1.00'))))
        .code,
    ).toBe('NOT_FOUND');
    expect(
      (await rejection(world.allocate.execute(world.owner, draft(payment.id, 'inv_nope', '1.00'))))
        .code,
    ).toBe('NOT_FOUND');
    const zero = await rejection(
      world.allocate.execute(world.owner, draft(payment.id, 'inv_ok', '0.00', '-3.00')),
    );
    expect(zero.fieldErrors).toMatchObject({
      'allocations.0.amountPaymentCurrency': ['validation.money.mustBePositive'],
      'allocations.0.amountInvoiceCurrency': ['validation.money.invalid'],
    });
  });

  it.each(['member', 'viewer'] as const)('%s gets FORBIDDEN', async (role) => {
    world.addInvoice('inv_f', '100.00');
    const payment = await credit300();
    const error = await rejection(
      world.allocate.execute(world[role], draft(payment.id, 'inv_f', '10.00')),
    );
    expect(error.code).toBe('FORBIDDEN');
  });
});

describe('deallocatePayment: the amount goes back to the credit', () => {
  async function allocated() {
    world.addInvoice('inv_d', '400.00', { projectId: WEB });
    const payment = await credit300();
    const allocation = await world.allocate.execute(
      world.owner,
      draft(payment.id, 'inv_d', '120.00'),
    );
    world.projector.calls.length = 0;
    return { payment, allocation };
  }

  it('soft-deletes the allocation, restores the invoice and the credit, and logs DEALLOCATE', async () => {
    const { payment, allocation } = await allocated();
    const after = await world.deallocate.execute(world.owner, { allocationId: allocation.id });

    expect(after).toMatchObject({ id: payment.id, allocated: '0.00', unallocated: '300.00' });
    expect(after.allocations).toEqual([]);
    expect(world.payments.allAllocations).toHaveLength(1);
    expect(world.payments.allAllocations[0]?.deletedAt).not.toBeNull();
    expect(await world.invoices.findById('inv_d')).toMatchObject({
      paidAmount: '0.00',
      balance: '400.00',
      status: 'EMITIDA',
    });
    expect(world.projector.calls).toEqual([
      `payment:${payment.id}`,
      `account:${ACC_USD}`,
      `clients:${KAIROS}`,
      `projects:${WEB}`,
    ]);
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'DEALLOCATE',
      entityId: payment.id,
      metadata: { allocationId: allocation.id, invoiceId: 'inv_d' },
    });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('allows the same invoice again after a deallocation (the unique index covers live rows only)', async () => {
    const { payment, allocation } = await allocated();
    await world.deallocate.execute(world.owner, { allocationId: allocation.id });
    const again = await world.allocate.execute(world.owner, draft(payment.id, 'inv_d', '10.00'));
    expect(again.amountPaymentCurrency).toBe('10.00');
  });

  it('answers NOT_FOUND for an unknown or already removed allocation', async () => {
    const { allocation } = await allocated();
    await world.deallocate.execute(world.owner, { allocationId: allocation.id });
    for (const allocationId of [allocation.id, 'alo_missing', '']) {
      const error = await rejection(world.deallocate.execute(world.owner, { allocationId }));
      expect(error.code).toBe('NOT_FOUND');
    }
  });

  it.each(['member', 'viewer'] as const)('%s gets FORBIDDEN', async (role) => {
    const { allocation } = await allocated();
    const error = await rejection(
      world.deallocate.execute(world[role], { allocationId: allocation.id }),
    );
    expect(error.code).toBe('FORBIDDEN');
    expect(world.payments.allAllocations[0]?.deletedAt).toBeNull();
  });
});
