import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACC_USD,
  ACC_USD_2,
  ACC_VES,
  KAIROS,
  PM_CASH,
  PM_ZELLE,
  ZAFIRO,
  createPaymentsWorld,
  paymentRecord,
  query,
  rejection,
  type PaymentsWorld,
} from './world';

let world: PaymentsWorld;
beforeEach(() => {
  world = createPaymentsWorld();
  // PAG-0001 300 USD with 250 applied, PAG-0002 500 USD fully applied, PAG-0003 100 USD (IGTF 3) with 97 credit.
  world.payments.seed(
    paymentRecord({
      id: 'pay_1',
      code: 'PAG-0001',
      date: '2026-09-01',
      amount: '300.00',
      allocatable: '300.00',
      netCredited: '300.00',
      unallocated: '50.00',
      amountUsd: '300.00',
      reference: 'ZL-0001',
    }),
  );
  world.payments.seed(
    paymentRecord({
      id: 'pay_2',
      code: 'PAG-0002',
      date: '2026-09-15',
      amount: '500.00',
      allocatable: '500.00',
      netCredited: '500.00',
      unallocated: '0.00',
      amountUsd: '500.00',
      reference: 'ZL-MOCK-0002',
      accountId: ACC_USD_2,
      methodId: PM_CASH,
    }),
  );
  world.payments.seed(
    paymentRecord({
      id: 'pay_3',
      code: 'PAG-0003',
      date: '2026-10-01',
      igtfAmount: '3.00',
      allocatable: '97.00',
      unallocated: '97.00',
      reference: 'ZL-0003',
    }),
  );
});

describe('listPayments', () => {
  it('lists the payments, newest first, with the derived columns and the page envelope', async () => {
    const page = await world.list.execute(world.owner, query());
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 25 });
    expect(page.items.map((row) => row.code)).toEqual(['PAG-0003', 'PAG-0002', 'PAG-0001']);
    expect(page.items[2]).toMatchObject({
      id: 'pay_1',
      client: { id: KAIROS, label: 'Kairos' },
      method: { id: PM_ZELLE, code: 'ZELLE' },
      account: { id: ACC_USD, label: 'Zelle' },
      amount: '300.00',
      amountUsd: '300.00',
      allocated: '250.00',
      unallocated: '50.00',
      reference: 'ZL-0001',
      status: 'CONFIRMADO',
    });
  });

  it('filters by the facets and searches by code, reference or client', async () => {
    const filtered = async (filters: Record<string, string | string[]>, q?: string) =>
      (await world.list.execute(world.owner, query({ filters, ...(q ? { q } : {}) }))).items.map(
        (row) => row.code,
      );
    expect(await filtered({ hasUnallocated: 'true' })).toEqual(['PAG-0003', 'PAG-0001']);
    expect(await filtered({ hasUnallocated: 'false' })).toEqual([
      'PAG-0003',
      'PAG-0002',
      'PAG-0001',
    ]);
    expect(await filtered({ clientId: [KAIROS] })).toHaveLength(3);
    expect(await filtered({ clientId: ZAFIRO })).toEqual([]);
    expect(await filtered({ accountId: ACC_USD_2 })).toEqual(['PAG-0002']);
    expect(await filtered({ methodId: PM_CASH })).toEqual(['PAG-0002']);
    expect(await filtered({ currency: ['USD'], status: ['CONFIRMADO'] })).toHaveLength(3);
    expect(await filtered({ status: 'ANULADO' })).toEqual([]);
    expect(await filtered({ dateFrom: '2026-09-10', dateTo: '2026-09-30' })).toEqual(['PAG-0002']);
    expect(await filtered({}, 'ZL-MOCK-0002')).toEqual(['PAG-0002']);
    expect(await filtered({ tagId: 'tag_1' })).toHaveLength(3);
  });

  it('honours the sort and refuses the values the DTO would refuse', async () => {
    const page = await world.list.execute(
      world.owner,
      query({ sort: { field: 'amount', direction: 'asc' } }),
    );
    expect(page.items.map((row) => row.amount)).toEqual(['100.00', '300.00', '500.00']);

    for (const [over, field] of [
      [{ filters: { status: 'LOST' } }, 'status'],
      [{ filters: { dateFrom: '2026-02-30' } }, 'dateFrom'],
      [{ filters: { dateTo: 'soon' } }, 'dateTo'],
      [{ filters: { hasUnallocated: 'maybe' } }, 'hasUnallocated'],
      [{ sort: { field: 'client', direction: 'asc' as const } }, 'sort'],
    ] as const) {
      const error = await rejection(world.list.execute(world.owner, query(over as never)));
      expect(error.code).toBe('VALIDATION');
      expect(Object.keys(error.fieldErrors ?? {})).toEqual([field]);
    }
  });

  it.each(['member', 'viewer'] as const)('%s gets FORBIDDEN', async (role) => {
    expect((await rejection(world.list.execute(world[role], query()))).code).toBe('FORBIDDEN');
  });
});

describe('getPayment', () => {
  it('returns the detail with its amounts and allocations, and NOT_FOUND for an unknown id (C14)', async () => {
    world.addInvoice('inv_1', '1000.00');
    world.payments.seed(
      paymentRecord({ id: 'pay_alloc', code: 'PAG-0009', unallocated: '70.00' }),
      [
        {
          id: 'alo_1',
          paymentId: 'pay_alloc',
          invoiceId: 'inv_1',
          amountPaymentCurrency: '30.00',
          amountInvoiceCurrency: '30.00',
          amountUsd: '30.00',
          createdAt: '2026-10-09T15:00:00.000Z',
          createdById: null,
          deletedAt: null,
        },
        {
          id: 'alo_gone',
          paymentId: 'pay_alloc',
          invoiceId: 'inv_1',
          amountPaymentCurrency: '9.00',
          amountInvoiceCurrency: '9.00',
          amountUsd: '9.00',
          createdAt: '2026-10-09T15:00:00.000Z',
          createdById: null,
          deletedAt: '2026-10-09T16:00:00.000Z',
        },
      ],
    );
    const payment = await world.get.execute(world.owner, 'pay_alloc');
    expect(payment).toMatchObject({ code: 'PAG-0009', allocated: '30.00', unallocated: '70.00' });
    expect(payment.allocations.map((a) => a.id)).toEqual(['alo_1']);

    expect((await rejection(world.get.execute(world.owner, 'pay_missing'))).code).toBe('NOT_FOUND');
    expect((await rejection(world.get.execute(world.member, 'pay_alloc'))).code).toBe('FORBIDDEN');
  });
});

describe('getClientCredit: HU-13 CA5', () => {
  it('the unallocated remainder of the confirmed payments is the credit, in USD', async () => {
    const credit = await world.credit.execute(world.owner, KAIROS);
    expect(credit.payments.map((row) => row.code)).toEqual(['PAG-0001', 'PAG-0003']);
    expect(credit.payments[1]).toMatchObject({
      paymentId: 'pay_3',
      date: '2026-10-01',
      currency: 'USD',
      unallocated: '97.00',
      unallocatedUsd: '97.00',
    });
    expect(credit.totalUsd).toBe('147.00');
  });

  it('converts a foreign-currency remainder at the payment rate and ignores unconfirmed payments', async () => {
    world.payments.seed(
      paymentRecord({
        id: 'pay_ves',
        code: 'PAG-0004',
        accountId: ACC_VES,
        currency: 'VES',
        amount: '3650.00',
        allocatable: '3650.00',
        unallocated: '3650.00',
        usdRate: '36.50',
        amountUsd: '100.00',
      }),
    );
    world.payments.seed(
      paymentRecord({ id: 'pay_pending', code: 'PAG-0005', status: 'PENDIENTE_VERIFICACION' }),
    );
    world.payments.seed(paymentRecord({ id: 'pay_void', code: 'PAG-0006', status: 'ANULADO' }));
    const credit = await world.credit.execute(world.owner, KAIROS);
    expect(credit.payments.find((row) => row.paymentId === 'pay_ves')?.unallocatedUsd).toBe(
      '100.00',
    );
    expect(credit.totalUsd).toBe('247.00');
    expect(credit.payments).toHaveLength(3);
  });

  it('is zero without payments, NOT_FOUND for an unknown client and FORBIDDEN for member', async () => {
    expect(await world.credit.execute(world.owner, ZAFIRO)).toEqual({
      totalUsd: '0.00',
      payments: [],
    });
    expect((await rejection(world.credit.execute(world.owner, 'cli_missing'))).code).toBe(
      'NOT_FOUND',
    );
    expect((await rejection(world.credit.execute(world.member, KAIROS))).code).toBe('FORBIDDEN');
  });
});

describe('detectDuplicatePayment: HU-13 CA6, a warning only', () => {
  const lookup = (over: Record<string, unknown> = {}) => ({
    methodId: PM_ZELLE,
    accountId: ACC_USD,
    reference: 'zl-0001',
    ...over,
  });

  it('warns when another payment has the same reference, method and account (case ignored)', async () => {
    const warning = await world.duplicates.execute(
      world.owner,
      lookup({ reference: '  ZL-0001 ' }),
    );
    expect(warning.duplicate).toBe(true);
    expect(warning.matches).toEqual([
      {
        payment: { type: 'PAYMENT', id: 'pay_1', code: 'PAG-0001', label: 'PAG-0001' },
        date: '2026-09-01',
        amount: '300.00',
        currency: 'USD',
        status: 'CONFIRMADO',
      },
    ]);
  });

  it('does not warn when the method or the account differs, for a voided payment or the one being edited', async () => {
    expect(
      (await world.duplicates.execute(world.owner, lookup({ methodId: PM_CASH }))).duplicate,
    ).toBe(false);
    expect(
      (await world.duplicates.execute(world.owner, lookup({ accountId: ACC_USD_2 }))).duplicate,
    ).toBe(false);
    expect(
      (await world.duplicates.execute(world.owner, lookup({ excludePaymentId: 'pay_1' })))
        .duplicate,
    ).toBe(false);
    world.payments.seed(paymentRecord({ id: 'pay_v', reference: 'VOIDED-1', status: 'ANULADO' }));
    expect(
      (await world.duplicates.execute(world.owner, lookup({ reference: 'voided-1' }))).duplicate,
    ).toBe(false);
  });

  it('requires its three fields and is FORBIDDEN for member', async () => {
    for (const [over, field] of [
      [{ reference: '  ' }, 'reference'],
      [{ reference: 'x'.repeat(81) }, 'reference'],
      [{ methodId: '' }, 'methodId'],
      [{ accountId: '' }, 'accountId'],
    ] as const) {
      const error = await rejection(world.duplicates.execute(world.owner, lookup(over)));
      expect(error.code).toBe('VALIDATION');
      expect(Object.keys(error.fieldErrors ?? {})).toEqual([field]);
    }
    expect((await rejection(world.duplicates.execute(world.member, lookup()))).code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('getInvoiceForPayment: the payment form opened from an invoice', () => {
  it('returns the client and the open option while the invoice takes a payment', async () => {
    world.addInvoice('inv_start', '300.00');
    const context = await world.paymentContext.execute(world.owner, 'inv_start');
    expect(context.client).toMatchObject({ id: KAIROS, label: 'Kairos' });
    expect(context.invoice).toMatchObject({
      id: 'inv_start',
      code: 'FAC-T-inv_start',
      invoiceNumber: 'N-inv_start',
      currency: 'USD',
      usdRate: '1',
      dueDate: '2026-12-31',
      balance: '300.00',
      status: 'EMITIDA',
    });
  });

  it('is NOT_FOUND when the invoice is unknown or no longer takes a payment, FORBIDDEN for member', async () => {
    world.addInvoice('inv_void', '300.00', {
      voidedAt: '2026-10-01T10:00:00.000Z',
      status: 'ANULADA',
    });
    world.addInvoice('inv_paid', '300.00', { balance: '0.00', status: 'PAGADA' });
    world.addInvoice('inv_arch', '300.00', { archivedAt: '2026-10-01T10:00:00.000Z' });
    for (const id of ['inv_void', 'inv_paid', 'inv_arch', 'inv_missing']) {
      expect((await rejection(world.paymentContext.execute(world.owner, id))).code, id).toBe(
        'NOT_FOUND',
      );
    }
    world.addInvoice('inv_ok', '10.00');
    expect((await rejection(world.paymentContext.execute(world.member, 'inv_ok'))).code).toBe(
      'FORBIDDEN',
    );
  });
});
