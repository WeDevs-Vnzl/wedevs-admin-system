import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACC_OFF,
  ACC_USD,
  ACC_VES,
  KAIROS,
  PM_CASH,
  PM_ZELLE,
  WEB,
  WEB_1,
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

const allocation = (invoiceId: string, payment: string, invoice = payment) => ({
  invoiceId,
  amountPaymentCurrency: payment,
  amountInvoiceCurrency: invoice,
});

/** The state a refused command must leave untouched. */
function expectNothingWritten() {
  expect(world.payments.all).toHaveLength(0);
  expect(world.payments.allAllocations).toHaveLength(0);
  expect(world.activity.entries).toHaveLength(0);
  expect(world.search.size).toBe(0);
}

describe('createPayment: HU-13 CA1 required fields and the method reference rule', () => {
  it('registers a confirmed payment with a PAG code, the USD snapshot and its record', async () => {
    const payment = await world.create.execute(world.owner, paymentInput());

    expect(payment).toMatchObject({
      code: 'PAG-0001',
      status: 'CONFIRMADO',
      currency: 'USD',
      amount: '100.00',
      amountUsd: '100.00',
      usdRate: '1.00000000',
      igtfAmount: '0.00',
      feeAmount: '0.00',
      allocatable: '100.00',
      netCredited: '100.00',
      allocated: '0.00',
      unallocated: '100.00',
      reference: 'REF-TEST-1',
      receiptFileId: null,
      createdById: world.owner.userId,
      client: { type: 'CLIENT', id: KAIROS, label: 'Kairos' },
      account: { type: 'ACCOUNT', id: ACC_USD, label: 'Zelle' },
      method: { id: PM_ZELLE, code: 'ZELLE' },
      allocations: [],
    });
    expect(world.payments.all).toHaveLength(1);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('refuses a missing reference for a method that requires it, and accepts it for cash', async () => {
    const error = await rejection(
      world.create.execute(world.owner, paymentInput({ reference: undefined })),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { reference: ['payments.validation.referenceRequired'] },
    });
    expectNothingWritten();

    const cash = await world.create.execute(
      world.owner,
      paymentInput({ reference: undefined, methodId: PM_CASH }),
    );
    expect(cash.reference).toBeNull();
    const blank = await world.create.execute(
      world.owner,
      paymentInput({ reference: '   ', methodId: PM_CASH }),
    );
    expect(blank.reference).toBeNull();
  });

  it('refuses a payment in a currency other than the account', async () => {
    const error = await rejection(
      world.create.execute(world.owner, paymentInput({ currency: 'VES', usdRate: '36.5' })),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { currency: ['payments.validation.currencyMismatch'] },
    });
    expectNothingWritten();
  });

  it('refuses an inactive account', async () => {
    const error = await rejection(
      world.create.execute(world.owner, paymentInput({ accountId: ACC_OFF })),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { accountId: ['accounts.validation.inactive'] },
    });
  });

  it('answers NOT_FOUND for an unknown client, account or method (C14)', async () => {
    for (const over of [
      { clientId: 'cli_missing' },
      { accountId: 'acc_missing' },
      { methodId: 'pmt_missing' },
    ]) {
      const error = await rejection(world.create.execute(world.owner, paymentInput(over)));
      expect(error.code).toBe('NOT_FOUND');
    }
    expectNothingWritten();
  });

  it('enforces the field rules in the use case, without the DTO (lesson B2)', async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ amount: '0.00' }, 'amount', 'validation.money.mustBePositive'],
      [{ amount: '-5.00' }, 'amount', 'validation.money.invalid'],
      [{ amount: '10.005' }, 'amount', 'validation.money.tooManyDecimals'],
      [{ amount: 'abc' }, 'amount', 'validation.money.invalid'],
      [{ igtfAmount: '150.00' }, 'igtfAmount', 'payments.validation.igtfExceedsAmount'],
      [{ feeAmount: '100.01' }, 'feeAmount', 'payments.validation.feeExceedsAmount'],
      [{ igtfAmount: '-1.00' }, 'igtfAmount', 'validation.money.invalid'],
      [{ usdRate: '2' }, 'usdRate', 'catalogs.validation.usdRateMustBeOne'],
      [{ usdRate: '0' }, 'usdRate', 'validation.rate.mustBePositive'],
      [{ date: '2026-02-30' }, 'date', 'validation.date.invalid'],
      [{ currency: 'usd' }, 'currency', 'validation.currency.invalid'],
      [{ clientId: '' }, 'clientId', 'validation.required'],
      [{ reference: 'x'.repeat(81) }, 'reference', 'validation.tooLong'],
      [{ status: 'ANULADO' }, 'status', 'validation.invalidOption'],
      [{ receiptFileId: '' }, 'receiptFileId', 'validation.required'],
    ];
    for (const [over, field, key] of cases) {
      const error = await rejection(world.create.execute(world.owner, paymentInput(over)));
      expect(error.code).toBe('VALIDATION');
      expect(error.fieldErrors?.[field], JSON.stringify(over)).toContain(key);
    }
    expectNothingWritten();
  });
});

describe('createPayment: HU-13 CA2 IGTF and net credit (§9.6)', () => {
  it('100 USD with IGTF 3 and fee 0: allocatable 97, net credited 100, unallocated 97', async () => {
    const payment = await world.create.execute(world.owner, paymentInput({ igtfAmount: '3.00' }));
    expect(payment).toMatchObject({
      allocatable: '97.00',
      netCredited: '100.00',
      unallocated: '97.00',
      allocated: '0.00',
    });
  });

  it('a fee reduces the net credited and not the allocatable amount', async () => {
    const payment = await world.create.execute(world.owner, paymentInput({ feeAmount: '2.50' }));
    expect(payment).toMatchObject({ netCredited: '97.50', allocatable: '100.00' });
  });
});

describe('createPayment: HU-13 CA3 allocations', () => {
  it('applies the allocations, recomputes the invoice and keeps the rest as credit', async () => {
    world.addInvoice('inv_partial', '1000.00');
    const payment = await world.create.execute(
      world.owner,
      paymentInput({
        amount: '300.00',
        allocations: [allocation('inv_partial', '250.00')],
      }),
    );

    expect(payment.allocated).toBe('250.00');
    expect(payment.unallocated).toBe('50.00');
    expect(payment.allocations).toHaveLength(1);
    expect(payment.allocations[0]).toMatchObject({
      invoice: { type: 'INVOICE', id: 'inv_partial', code: 'FAC-T-inv_partial' },
      invoiceCurrency: 'USD',
      amountPaymentCurrency: '250.00',
      amountInvoiceCurrency: '250.00',
      amountUsd: '250.00',
    });
    const invoice = await world.invoices.findById('inv_partial');
    expect(invoice).toMatchObject({ paidAmount: '250.00', balance: '750.00', status: 'PARCIAL' });
  });

  it('settles an invoice that is paid in full', async () => {
    world.addInvoice('inv_full', '100.00');
    await world.create.execute(
      world.owner,
      paymentInput({ allocations: [allocation('inv_full', '100.00')] }),
    );
    expect(await world.invoices.findById('inv_full')).toMatchObject({
      paidAmount: '100.00',
      balance: '0.00',
      status: 'PAGADA',
    });
  });

  it('the sum of the allocations cannot exceed the allocatable amount', async () => {
    world.addInvoice('inv_a', '1000.00');
    world.addInvoice('inv_b', '1000.00');
    const error = await rejection(
      world.create.execute(
        world.owner,
        paymentInput({
          igtfAmount: '3.00',
          allocations: [allocation('inv_a', '60.00'), allocation('inv_b', '40.00')],
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { allocations: ['payments.validation.allocationsExceedAllocatable'] },
    });
    expectNothingWritten();
  });

  it('each allocation cannot exceed the balance of its invoice', async () => {
    world.addInvoice('inv_small', '50.00');
    const error = await rejection(
      world.create.execute(
        world.owner,
        paymentInput({ allocations: [allocation('inv_small', '60.00')] }),
      ),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: {
        'allocations.0.amountInvoiceCurrency': ['payments.validation.allocationExceedsBalance'],
      },
    });
    expectNothingWritten();
  });

  it('refuses an invoice of another client, a voided, an archived and a draft one', async () => {
    world.addInvoice('inv_other', '100.00', { clientId: ZAFIRO });
    world.addInvoice('inv_void', '100.00', {
      voidedAt: '2026-10-01T10:00:00.000Z',
      status: 'ANULADA',
    });
    world.addInvoice('inv_arch', '100.00', { archivedAt: '2026-10-01T10:00:00.000Z' });
    world.addInvoice('inv_draft', '100.00', { isDraft: true, status: 'BORRADOR' });
    world.addInvoice('inv_paid', '100.00', { balance: '0.00', status: 'PAGADA' });
    for (const id of ['inv_other', 'inv_void', 'inv_arch', 'inv_draft', 'inv_paid']) {
      const error = await rejection(
        world.create.execute(world.owner, paymentInput({ allocations: [allocation(id, '10.00')] })),
      );
      expect(error, id).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: {
          'allocations.0.invoiceId': ['payments.validation.allocationInvoiceNotOpen'],
        },
      });
    }
    expectNothingWritten();
  });

  it('answers NOT_FOUND for an unknown invoice', async () => {
    const error = await rejection(
      world.create.execute(
        world.owner,
        paymentInput({ allocations: [allocation('inv_missing', '10.00')] }),
      ),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it('in the same currency the invoice amount must equal the payment amount', async () => {
    world.addInvoice('inv_same', '500.00');
    const error = await rejection(
      world.create.execute(
        world.owner,
        paymentInput({ allocations: [allocation('inv_same', '100.00', '90.00')] }),
      ),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: {
        'allocations.0.amountInvoiceCurrency': ['payments.validation.allocationSameCurrency'],
      },
    });
  });

  it('refuses the same invoice twice, a malformed allocation and more than 50', async () => {
    world.addInvoice('inv_dup', '500.00');
    const dup = await rejection(
      world.create.execute(
        world.owner,
        paymentInput({
          allocations: [allocation('inv_dup', '10.00'), allocation('inv_dup', '10.00')],
        }),
      ),
    );
    expect(dup.fieldErrors).toEqual({
      'allocations.1.invoiceId': ['payments.validation.duplicateInvoiceAllocation'],
    });

    const bad = await rejection(
      world.create.execute(
        world.owner,
        paymentInput({ allocations: [allocation('', '0.00', '-1.00')] }),
      ),
    );
    expect(bad.fieldErrors).toMatchObject({
      'allocations.0.invoiceId': ['validation.required'],
      'allocations.0.amountPaymentCurrency': ['validation.money.mustBePositive'],
      'allocations.0.amountInvoiceCurrency': ['validation.money.invalid'],
    });

    const many = await rejection(
      world.create.execute(
        world.owner,
        paymentInput({
          allocations: Array.from({ length: 51 }, (_, i) => allocation(`inv_${i}`, '1.00')),
        }),
      ),
    );
    expect(many.fieldErrors).toEqual({ allocations: ['validation.tooLarge'] });
    expectNothingWritten();
  });

  it('a pending payment keeps its allocations out of the invoice balance until it is confirmed', async () => {
    world.addInvoice('inv_pending', '400.00');
    const payment = await world.create.execute(
      world.owner,
      paymentInput({
        status: 'PENDIENTE_VERIFICACION',
        allocations: [allocation('inv_pending', '100.00')],
      }),
    );
    expect(payment).toMatchObject({ status: 'PENDIENTE_VERIFICACION', unallocated: '0.00' });
    expect(await world.invoices.findById('inv_pending')).toMatchObject({
      paidAmount: '0.00',
      balance: '400.00',
      status: 'EMITIDA',
    });
  });
});

describe('createPayment: HU-13 CA4 cross-currency allocation (§9.5)', () => {
  it('a VES payment on a USD invoice stores the USD snapshot at the payment rate, once', async () => {
    world.addInvoice('inv_usd', '1000.00');
    const payment = await world.create.execute(
      world.owner,
      paymentInput({
        accountId: ACC_VES,
        currency: 'VES',
        amount: '36500.00',
        usdRate: '36.50',
        // The user edited the proposal down to 990 USD: accepted, the rest stays as credit.
        allocations: [allocation('inv_usd', '36135.00', '990.00')],
      }),
    );

    expect(payment).toMatchObject({
      amountUsd: '1000.00',
      unallocated: '365.00',
      allocated: '36135.00',
    });
    expect(payment.allocations[0]).toMatchObject({
      amountPaymentCurrency: '36135.00',
      amountInvoiceCurrency: '990.00',
      amountUsd: '990.00',
    });
    expect(await world.invoices.findById('inv_usd')).toMatchObject({
      paidAmount: '990.00',
      balance: '10.00',
      status: 'PARCIAL',
    });
  });
});

describe('createPayment: HU-13 CA6 duplicates are not a refusal', () => {
  it('saves a second payment with the same reference, method and account', async () => {
    await world.create.execute(world.owner, paymentInput({ reference: 'OP-DUP' }));
    const second = await world.create.execute(world.owner, paymentInput({ reference: 'OP-DUP' }));
    expect(second.code).toBe('PAG-0002');
    expect(world.payments.all.filter((row) => row.reference === 'OP-DUP')).toHaveLength(2);
  });
});

describe('createPayment: receipt (HU-14, DT-41, C23)', () => {
  it.each(['file_pdf', 'file_png', 'file_jpg', 'file_webp'])(
    'accepts %s up to 10 MB',
    async (id) => {
      const payment = await world.create.execute(world.owner, paymentInput({ receiptFileId: id }));
      expect(payment.receiptFileId).toBe(id);
      expect(world.reservedReceipts).toEqual([id]);
    },
  );

  it('refuses a type outside PDF, PNG, JPG and WEBP, an empty file and one above 10 MB', async () => {
    for (const [id, key] of [
      ['file_zip', 'validation.file.typeNotAllowed'],
      ['file_empty', 'validation.file.empty'],
      ['file_big', 'validation.file.tooLargeMax'],
    ] as const) {
      const error = await rejection(
        world.create.execute(world.owner, paymentInput({ receiptFileId: id })),
      );
      expect(error).toMatchObject({ code: 'VALIDATION', fieldErrors: { receiptFileId: [key] } });
    }
    expectNothingWritten();
  });

  it('an unknown or foreign file is a plain NOT_FOUND and a storage failure rolls everything back', async () => {
    const unknown = await rejection(
      world.create.execute(world.owner, paymentInput({ receiptFileId: 'file_unknown' })),
    );
    expect(unknown.code).toBe('NOT_FOUND');
    await expect(
      world.create.execute(world.owner, paymentInput({ receiptFileId: 'file_boom' })),
    ).rejects.toThrow('storage down');
    expectNothingWritten();
  });
});

describe('createPayment: the tail of the unit of work', () => {
  it('locks client and account once, in the global order, with the invoices it allocates to', async () => {
    world.addInvoice('inv_b', '100.00', { projectId: WEB, installmentId: WEB_1 });
    world.addInvoice('inv_a', '100.00', { projectId: WEB });
    await world.create.execute(
      world.owner,
      paymentInput({
        amount: '200.00',
        allocations: [allocation('inv_b', '50.00'), allocation('inv_a', '50.00')],
      }),
    );
    expect(world.locks.acquired).toEqual([
      { rowClass: 'Project', id: WEB },
      { rowClass: 'Client', id: KAIROS },
      { rowClass: 'BillingInstallment', id: WEB_1 },
      { rowClass: 'Invoice', id: 'inv_a' },
      { rowClass: 'Invoice', id: 'inv_b' },
      { rowClass: 'Account', id: ACC_USD },
    ]);
  });

  it('recomputes the invoices, then projects payment, account, client and projects, then logs', async () => {
    world.addInvoice('inv_p', '100.00', { projectId: WEB, installmentId: WEB_1 });
    const payment = await world.create.execute(
      world.owner,
      paymentInput({ allocations: [allocation('inv_p', '60.00')] }),
    );
    expect(world.projector.calls).toEqual([
      `payment:${payment.id}`,
      `account:${ACC_USD}`,
      `clients:${KAIROS}`,
      `projects:${WEB}`,
    ]);
    expect(world.recomputedInstallments).toEqual([[WEB_1]]);
  });

  it('indexes the payment and the touched invoice and writes the CREATE activity', async () => {
    world.addInvoice('inv_s', '100.00');
    const payment = await world.create.execute(
      world.owner,
      paymentInput({ allocations: [allocation('inv_s', '100.00')] }),
    );
    expect(world.search.get('PAYMENT', payment.id)).toMatchObject({
      code: 'PAG-0001',
      title: 'REF-TEST-1',
      subtitle: 'Kairos',
      status: 'CONFIRMADO',
      archived: false,
    });
    expect(world.search.get('INVOICE', 'inv_s')).toMatchObject({ status: 'PAGADA' });
    expect(world.activity.entries).toHaveLength(1);
    expect(world.activity.entries[0]).toMatchObject({
      action: 'CREATE',
      entityType: 'PAYMENT',
      entityId: payment.id,
      entityLabel: 'PAG-0001',
      clientId: KAIROS,
      touchClientIds: [KAIROS],
      metadata: { code: 'PAG-0001' },
    });
    expect(world.activity.entries[0]?.actor).toMatchObject({ actorType: 'USER' });
  });

  it('a failure after the writes rolls the payment, its allocations and the invoice back', async () => {
    world.addInvoice('inv_r', '100.00');
    await expect(
      world.create.execute(
        world.owner,
        paymentInput({ receiptFileId: 'file_boom', allocations: [allocation('inv_r', '10.00')] }),
      ),
    ).rejects.toThrow('storage down');
    expectNothingWritten();
    expect(await world.invoices.findById('inv_r')).toMatchObject({ balance: '100.00' });
  });
});

describe('createPayment: authorization (PRD §4.3)', () => {
  it.each(['member', 'viewer'] as const)(
    '%s gets FORBIDDEN and nothing is written',
    async (role) => {
      const error = await rejection(world.create.execute(world[role], paymentInput()));
      expect(error.code).toBe('FORBIDDEN');
      expectNothingWritten();
    },
  );

  it('owner and admin may register payments', async () => {
    await world.create.execute(world.admin, paymentInput());
    await world.create.execute(world.owner, paymentInput());
    expect(world.payments.all).toHaveLength(2);
  });
});
