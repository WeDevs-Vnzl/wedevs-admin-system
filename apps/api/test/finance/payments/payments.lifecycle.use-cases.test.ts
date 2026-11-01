import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACC_OFF,
  ACC_USD,
  ACC_USD_2,
  ACC_VES,
  KAIROS,
  PM_CASH,
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

/** The fields `updatePayment` takes, from a created payment, overridden field by field. */
const fieldsOf = (payment: Record<string, unknown>, over: Record<string, unknown> = {}): never =>
  ({
    id: payment.id,
    clientId: payment.clientId,
    date: payment.date,
    accountId: payment.accountId,
    methodId: payment.methodId,
    currency: payment.currency,
    amount: payment.amount,
    igtfAmount: payment.igtfAmount,
    feeAmount: payment.feeAmount,
    usdRate: payment.usdRate,
    reference: payment.reference,
    ...over,
  }) as never;

async function created(over: Record<string, unknown> = {}) {
  const payment = await world.create.execute(world.owner, paymentInput(over));
  world.projector.calls.length = 0;
  return payment;
}

describe('updatePayment (Q-BE3-3)', () => {
  it('edits the fields, derives the cached columns again and logs the changed fields', async () => {
    const payment = await created();
    const updated = await world.update.execute(
      world.owner,
      fieldsOf(payment as never, {
        date: '2026-10-06',
        amount: '200.00',
        igtfAmount: '5.00',
        feeAmount: '1.00',
        reference: '  OP-NEW  ',
      }),
    );

    expect(updated).toMatchObject({
      id: payment.id,
      code: payment.code,
      date: '2026-10-06',
      amount: '200.00',
      amountUsd: '200.00',
      allocatable: '195.00',
      netCredited: '199.00',
      unallocated: '195.00',
      reference: 'OP-NEW',
    });
    expect(world.payments.all[0]?.updatedById).toBe(world.owner.userId);
    expect(world.projector.calls).toEqual([
      `payment:${payment.id}`,
      `account:${ACC_USD}`,
      `clients:${KAIROS}`,
    ]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    const entry = world.activity.entries.at(-1);
    expect(entry).toMatchObject({
      action: 'UPDATE',
      entityType: 'PAYMENT',
      entityId: payment.id,
      changes: {
        amount: ['100.00', '200.00'],
        date: ['2026-10-05', '2026-10-06'],
        igtfAmount: ['0.00', '5.00'],
      },
    });
    expect(world.search.get('PAYMENT', payment.id)).toMatchObject({ title: 'OP-NEW' });
  });

  it('a new rate recomputes the USD snapshots of the payment and of its live allocations (C16, PRD:1235)', async () => {
    world.addInvoice('inv_r', '500.00');
    const payment = await created({
      accountId: ACC_VES,
      currency: 'VES',
      amount: '3650.00',
      usdRate: '36.50',
      allocations: [
        { invoiceId: 'inv_r', amountPaymentCurrency: '1825.00', amountInvoiceCurrency: '50.00' },
      ],
    });
    const updated = await world.update.execute(
      world.owner,
      fieldsOf(payment as never, { usdRate: '40.00' }),
    );
    expect(updated.amountUsd).toBe('91.25');
    expect(updated.allocations[0]?.amountUsd).toBe('45.63');
    expect(updated.allocations[0]?.amountPaymentCurrency).toBe('1825.00');
    expect(updated.allocations[0]?.amountInvoiceCurrency).toBe('50.00');
  });

  it('keeps the allocation snapshot when the rate does not change', async () => {
    world.addInvoice('inv_s', '500.00');
    const payment = await created({
      accountId: ACC_VES,
      currency: 'VES',
      amount: '3650.00',
      usdRate: '36.50',
      allocations: [
        { invoiceId: 'inv_s', amountPaymentCurrency: '1825.00', amountInvoiceCurrency: '50.00' },
      ],
    });
    const updated = await world.update.execute(
      world.owner,
      fieldsOf(payment as never, { reference: 'OP-SAME' }),
    );
    expect(updated.allocations[0]?.amountUsd).toBe('50.00');
  });

  it('moves the payment to another account: both balances are recomputed and both rows locked', async () => {
    const payment = await created();
    await world.update.execute(world.owner, fieldsOf(payment as never, { accountId: ACC_USD_2 }));
    expect(world.projector.calls).toEqual([
      `payment:${payment.id}`,
      `account:${ACC_USD}`,
      `account:${ACC_USD_2}`,
      `clients:${KAIROS}`,
    ]);
    expect(world.locks.acquired.map((row) => row.id)).toEqual([
      KAIROS,
      payment.id,
      ACC_USD,
      ACC_USD_2,
    ]);
  });

  it('keeps the currency tied to the account and refuses an inactive target account', async () => {
    const payment = await created();
    const mismatch = await rejection(
      world.update.execute(world.owner, fieldsOf(payment as never, { accountId: ACC_VES })),
    );
    expect(mismatch.fieldErrors).toEqual({ currency: ['payments.validation.currencyMismatch'] });
    const inactive = await rejection(
      world.update.execute(world.owner, fieldsOf(payment as never, { accountId: ACC_OFF })),
    );
    expect(inactive.fieldErrors).toEqual({ accountId: ['accounts.validation.inactive'] });
  });

  it('applies the method reference rule and the field rules without the DTO', async () => {
    const payment = await created();
    const noReference = await rejection(
      world.update.execute(world.owner, fieldsOf(payment as never, { reference: null })),
    );
    expect(noReference.fieldErrors).toEqual({
      reference: ['payments.validation.referenceRequired'],
    });
    const cash = await world.update.execute(
      world.owner,
      fieldsOf(payment as never, { reference: null, methodId: PM_CASH }),
    );
    expect(cash).toMatchObject({ reference: null, method: { id: PM_CASH } });
    const invalid = await rejection(
      world.update.execute(world.owner, fieldsOf(payment as never, { amount: '0.00' })),
    );
    expect(invalid.fieldErrors).toEqual({ amount: ['validation.money.mustBePositive'] });
    expect(
      (
        await rejection(
          world.update.execute(
            world.owner,
            fieldsOf(payment as never, { methodId: 'pmt_missing' }),
          ),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  it('a voided payment is final and read-only', async () => {
    const payment = await created();
    await world.setStatus.execute(world.owner, { id: payment.id, status: 'ANULADO' });
    const error = await rejection(
      world.update.execute(world.owner, fieldsOf(payment as never, { reference: 'OP-2' })),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'payments.errors.voided' });
  });

  describe('with live allocations', () => {
    async function allocated() {
      world.addInvoice('inv_a', '500.00');
      const payment = await created({
        allocations: [
          { invoiceId: 'inv_a', amountPaymentCurrency: '80.00', amountInvoiceCurrency: '80.00' },
        ],
      });
      return payment;
    }

    it('keeps the client and the currency (INTEGRITY_LOCK)', async () => {
      const payment = await allocated();
      const client = await rejection(
        world.update.execute(world.owner, fieldsOf(payment as never, { clientId: ZAFIRO })),
      );
      expect(client).toMatchObject({
        code: 'INTEGRITY_LOCK',
        message: 'payments.errors.clientLocked',
      });
      const currency = await rejection(
        world.update.execute(
          world.owner,
          fieldsOf(payment as never, { accountId: ACC_VES, currency: 'VES', usdRate: '36.5' }),
        ),
      );
      expect(currency.code).toBe('INTEGRITY_LOCK');
    });

    it('never lets the allocatable amount drop below what is allocated', async () => {
      const payment = await allocated();
      for (const over of [{ amount: '70.00' }, { igtfAmount: '30.00' }]) {
        const error = await rejection(
          world.update.execute(world.owner, fieldsOf(payment as never, over)),
        );
        expect(error).toMatchObject({
          code: 'INTEGRITY_LOCK',
          message: 'payments.errors.allocatableBelowAllocated',
        });
      }
      const exact = await world.update.execute(
        world.owner,
        fieldsOf(payment as never, { amount: '80.00' }),
      );
      expect(exact).toMatchObject({
        allocatable: '80.00',
        unallocated: '0.00',
        allocated: '80.00',
      });
    });

    it('locks the invoices it is allocated to, with their projects', async () => {
      world.addInvoice('inv_p', '500.00', { projectId: WEB });
      const payment = await created({
        allocations: [
          { invoiceId: 'inv_p', amountPaymentCurrency: '10.00', amountInvoiceCurrency: '10.00' },
        ],
      });
      await world.update.execute(world.owner, fieldsOf(payment as never, { reference: 'OP-9' }));
      expect(world.locks.acquired).toEqual([
        { rowClass: 'Project', id: WEB },
        { rowClass: 'Client', id: KAIROS },
        { rowClass: 'Invoice', id: 'inv_p' },
        { rowClass: 'Payment', id: payment.id },
        { rowClass: 'Account', id: ACC_USD },
      ]);
    });
  });

  it('claims a new receipt, keeps it when absent and detaches it with null', async () => {
    const payment = await created({ receiptFileId: 'file_pdf' });
    expect(world.reservedReceipts).toEqual(['file_pdf']);
    const kept = await world.update.execute(world.owner, fieldsOf(payment as never));
    expect(kept.receiptFileId).toBe('file_pdf');
    expect(world.reservedReceipts).toEqual(['file_pdf']);
    const replaced = await world.update.execute(
      world.owner,
      fieldsOf(payment as never, { receiptFileId: 'file_png' }),
    );
    expect(replaced.receiptFileId).toBe('file_png');
    const bad = await rejection(
      world.update.execute(world.owner, fieldsOf(payment as never, { receiptFileId: 'file_zip' })),
    );
    expect(bad.fieldErrors).toEqual({ receiptFileId: ['validation.file.typeNotAllowed'] });
    const detached = await world.update.execute(
      world.owner,
      fieldsOf(payment as never, { receiptFileId: null }),
    );
    expect(detached.receiptFileId).toBeNull();
  });

  it('answers NOT_FOUND for an unknown payment or client and FORBIDDEN for member and viewer', async () => {
    const payment = await created();
    expect(
      (
        await rejection(
          world.update.execute(world.owner, fieldsOf(payment as never, { id: 'pay_x' })),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(
      (
        await rejection(
          world.update.execute(world.owner, fieldsOf(payment as never, { clientId: 'cli_x' })),
        )
      ).code,
    ).toBe('NOT_FOUND');
    for (const role of ['member', 'viewer'] as const) {
      const error = await rejection(
        world.update.execute(world[role], fieldsOf(payment as never, { reference: 'OP-3' })),
      );
      expect(error.code).toBe('FORBIDDEN');
    }
    expect(world.payments.all[0]?.reference).toBe('REF-TEST-1');
  });
});

describe('setPaymentStatus (Q-BE3-3, PRD:1257)', () => {
  it('confirms a pending payment: its allocations now pay the invoice', async () => {
    world.addInvoice('inv_c', '400.00', { projectId: WEB });
    const pending = await created({
      status: 'PENDIENTE_VERIFICACION',
      allocations: [
        { invoiceId: 'inv_c', amountPaymentCurrency: '100.00', amountInvoiceCurrency: '100.00' },
      ],
    });
    const confirmed = await world.setStatus.execute(world.owner, {
      id: pending.id,
      status: 'CONFIRMADO',
      reason: 'Verificado en el banco',
    });

    expect(confirmed.status).toBe('CONFIRMADO');
    expect(await world.invoices.findById('inv_c')).toMatchObject({
      paidAmount: '100.00',
      balance: '300.00',
      status: 'PARCIAL',
    });
    expect(world.projector.calls).toEqual([
      `payment:${pending.id}`,
      `account:${ACC_USD}`,
      `clients:${KAIROS}`,
      `projects:${WEB}`,
    ]);
    expect(world.search.get('PAYMENT', pending.id)).toMatchObject({ status: 'CONFIRMADO' });
    expect(world.search.get('INVOICE', 'inv_c')).toMatchObject({ status: 'PARCIAL' });
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'STATUS_CHANGE',
      entityId: pending.id,
      metadata: {
        code: pending.code,
        from: 'PENDIENTE_VERIFICACION',
        to: 'CONFIRMADO',
        reason: 'Verificado en el banco',
      },
    });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('rechecks the allocation limits on confirmation: the invoice balance may have moved', async () => {
    world.addInvoice('inv_m', '400.00');
    const pending = await created({
      status: 'PENDIENTE_VERIFICACION',
      allocations: [
        { invoiceId: 'inv_m', amountPaymentCurrency: '100.00', amountInvoiceCurrency: '100.00' },
      ],
    });
    await world.create.execute(
      world.owner,
      paymentInput({
        amount: '350.00',
        reference: 'OP-OTHER',
        allocations: [
          { invoiceId: 'inv_m', amountPaymentCurrency: '350.00', amountInvoiceCurrency: '350.00' },
        ],
      }),
    );
    const error = await rejection(
      world.setStatus.execute(world.owner, { id: pending.id, status: 'CONFIRMADO' }),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: {
        'allocations.0.amountInvoiceCurrency': ['payments.validation.allocationExceedsBalance'],
      },
    });
    expect(world.payments.all.find((row) => row.id === pending.id)?.status).toBe(
      'PENDIENTE_VERIFICACION',
    );
  });

  it('voids a confirmed payment: allocations are soft-deleted and the invoice, account and metrics recomputed', async () => {
    world.addInvoice('inv_v', '400.00', { projectId: WEB });
    const payment = await created({
      amount: '300.00',
      allocations: [
        { invoiceId: 'inv_v', amountPaymentCurrency: '120.00', amountInvoiceCurrency: '120.00' },
      ],
    });
    expect(await world.invoices.findById('inv_v')).toMatchObject({ balance: '280.00' });

    const voided = await world.setStatus.execute(world.owner, {
      id: payment.id,
      status: 'ANULADO',
      reason: 'Duplicado',
    });

    expect(voided).toMatchObject({
      status: 'ANULADO',
      allocations: [],
      allocated: '0.00',
      unallocated: '300.00',
    });
    expect(world.payments.allAllocations).toHaveLength(1);
    expect(world.payments.allAllocations[0]?.deletedAt).not.toBeNull();
    expect(await world.invoices.findById('inv_v')).toMatchObject({
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
      action: 'STATUS_CHANGE',
      metadata: { from: 'CONFIRMADO', to: 'ANULADO', reason: 'Duplicado' },
    });
    expect(world.locks.acquired.map((row) => row.rowClass)).toEqual([
      'Project',
      'Client',
      'Invoice',
      'Payment',
      'Account',
    ]);
  });

  it('a pending payment may be voided, and ANULADO is final', async () => {
    const pending = await created({ status: 'PENDIENTE_VERIFICACION' });
    await world.setStatus.execute(world.owner, { id: pending.id, status: 'ANULADO' });
    for (const status of ['CONFIRMADO', 'PENDIENTE_VERIFICACION', 'ANULADO'] as const) {
      const error = await rejection(
        world.setStatus.execute(world.owner, { id: pending.id, status }),
      );
      expect(error).toMatchObject({ code: 'CONFLICT', message: 'payments.errors.voided' });
    }
  });

  it('refuses the transitions that are not defined', async () => {
    const confirmed = await created();
    for (const status of ['PENDIENTE_VERIFICACION', 'CONFIRMADO'] as const) {
      const error = await rejection(
        world.setStatus.execute(world.owner, { id: confirmed.id, status }),
      );
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: 'payments.errors.invalidTransition',
      });
    }
    expect(world.payments.all[0]?.status).toBe('CONFIRMADO');
  });

  it('enforces the input rules, NOT_FOUND and the permissions', async () => {
    const payment = await created();
    const status = await rejection(
      world.setStatus.execute(world.owner, { id: payment.id, status: 'LOST' as never }),
    );
    expect(status.fieldErrors).toEqual({ status: ['validation.invalidOption'] });
    const reason = await rejection(
      world.setStatus.execute(world.owner, {
        id: payment.id,
        status: 'ANULADO',
        reason: 'x'.repeat(501),
      }),
    );
    expect(reason.fieldErrors).toEqual({ reason: ['validation.tooLong'] });
    expect(
      (await rejection(world.setStatus.execute(world.owner, { id: 'pay_x', status: 'ANULADO' })))
        .code,
    ).toBe('NOT_FOUND');
    for (const role of ['member', 'viewer'] as const) {
      const error = await rejection(
        world.setStatus.execute(world[role], { id: payment.id, status: 'ANULADO' }),
      );
      expect(error.code).toBe('FORBIDDEN');
    }
    expect(world.payments.all[0]?.status).toBe('CONFIRMADO');
  });

  it('omits the reason from the activity when none is given', async () => {
    const payment = await created();
    await world.setStatus.execute(world.owner, { id: payment.id, status: 'ANULADO', reason: '  ' });
    const entry = world.activity.entries.at(-1);
    expect(entry?.metadata).toEqual({ code: payment.code, from: 'CONFIRMADO', to: 'ANULADO' });
  });
});
