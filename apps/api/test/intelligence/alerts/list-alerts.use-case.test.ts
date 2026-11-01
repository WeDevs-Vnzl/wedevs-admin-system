import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../src/shared/domain/domain-error';
import type { AlertType } from '../../../src/modules/intelligence/domain/alert-type';
import {
  buildAlertsWorld,
  documentRow,
  expenseRow,
  installmentRow,
  invoiceRow,
  paymentRow,
  TODAY,
  userOf,
  type AlertsWorld,
} from './alerts-world';

const owner = userOf('OWNER');

async function only(world: AlertsWorld, type: AlertType, user = owner) {
  return world.list.execute(user, { types: [type] });
}

const keys = (r: { items: { alertKey: string }[] }) => r.items.map((i) => i.alertKey).sort();

describe('ListAlerts rules (PRD 7.9, ported from alerts.test.ts)', () => {
  it('invoice overdue: VENCIDA only, never drafts or archived', async () => {
    const w = buildAlertsWorld();
    w.sources.invoices.push(
      invoiceRow('a', -3, { status: 'VENCIDA' }),
      invoiceRow('draft', -3, { status: 'VENCIDA', isDraft: true }),
      invoiceRow('gone', -3, { status: 'VENCIDA', archived: true }),
      invoiceRow('open', -3),
    );
    const r = await only(w, 'INVOICE_OVERDUE');
    expect(r.items).toEqual([
      {
        alertKey: 'INVOICE_OVERDUE:a',
        type: 'INVOICE_OVERDUE',
        entity: { type: 'INVOICE', id: 'a', label: 'a' },
        date: '2026-01-12',
        days: -3,
        amount: { amount: '500.00', currency: 'USD' },
        context: 'Kairos',
      },
    ]);
  });

  it('invoice due soon: day 7 yes, day 8 no, balance 0.00 no, 0.01 yes', async () => {
    const w = buildAlertsWorld();
    w.sources.invoices.push(
      invoiceRow('d0', 0),
      invoiceRow('d7', 7),
      invoiceRow('d8', 8),
      invoiceRow('past', -1),
      invoiceRow('zero', 2, { balance: '0.00' }),
      invoiceRow('cent', 2, { balance: '0.01', status: 'PARCIAL' }),
    );
    expect(keys(await only(w, 'INVOICE_DUE_SOON'))).toEqual([
      'INVOICE_DUE_SOON:cent',
      'INVOICE_DUE_SOON:d0',
      'INVOICE_DUE_SOON:d7',
    ]);
  });

  it('installment: PENDIENTE due in 7 days or past; day 8, no date and billed ones are out (HU-10 CA4)', async () => {
    const w = buildAlertsWorld();
    w.sources.installments.push(
      installmentRow('i7', 7),
      installmentRow('i8', 8),
      installmentRow('ipast', -4),
      installmentRow('inull', null),
      installmentRow('ibilled', 1, { status: 'FACTURADA' }),
      installmentRow('icancelled', 1, { status: 'CANCELADA' }),
    );
    const r = await only(w, 'INSTALLMENT_TO_INVOICE');
    expect(keys(r)).toEqual(['INSTALLMENT_TO_INVOICE:i7', 'INSTALLMENT_TO_INVOICE:ipast']);
    expect(r.items[0]?.entity?.type).toBe('PROJECT');
    expect(r.items.find((i) => i.alertKey.endsWith('i7'))?.days).toBe(7);
  });

  it('document expiring: inside alertDaysBefore (default 30) inclusive, 31 days out', async () => {
    const w = buildAlertsWorld();
    w.sources.documents.push(
      documentRow('d30', 30),
      documentRow('d31', 31),
      documentRow('today', 0),
      documentRow('past', -1),
      documentRow('custom', 10, { alertDaysBefore: 10 }),
      documentRow('customOut', 11, { alertDaysBefore: 10 }),
      documentRow('void', 5, { status: 'ANULADO' }),
      documentRow('noDate', null),
    );
    expect(keys(await only(w, 'DOCUMENT_EXPIRING'))).toEqual([
      'DOCUMENT_EXPIRING:custom',
      'DOCUMENT_EXPIRING:d30',
      'DOCUMENT_EXPIRING:today',
    ]);
  });

  it('document expired: status VENCIDO, archived ones left out, no date allowed', async () => {
    const w = buildAlertsWorld();
    w.sources.documents.push(
      documentRow('e1', -2, { status: 'VENCIDO' }),
      documentRow('e2', null, { status: 'VENCIDO' }),
      documentRow('e3', -2, { status: 'VENCIDO', archived: true }),
    );
    const r = await only(w, 'DOCUMENT_EXPIRED');
    expect(keys(r)).toEqual(['DOCUMENT_EXPIRED:e1', 'DOCUMENT_EXPIRED:e2']);
    expect(r.items.find((i) => i.alertKey.endsWith('e2'))).toMatchObject({
      date: null,
      days: null,
    });
  });

  it('recurring expense: generated PENDIENTE due in 5 days or past; day 6 and manual ones out', async () => {
    const w = buildAlertsWorld();
    w.sources.expenses.push(
      expenseRow('x5', 5),
      expenseRow('x6', 6),
      expenseRow('xpast', -3),
      expenseRow('manual', 1, { recurring: false }),
      expenseRow('paid', 1, { status: 'PAGADO' }),
    );
    expect(keys(await only(w, 'RECURRING_EXPENSE_PENDING'))).toEqual([
      'RECURRING_EXPENSE_PENDING:x5',
      'RECURRING_EXPENSE_PENDING:xpast',
    ]);
  });

  it('payment to verify: 3 days old yes, 2 days no, age counted from the payment date', async () => {
    const w = buildAlertsWorld();
    w.sources.payments.push(paymentRow('p3', 3), paymentRow('p2', 2), paymentRow('future', -1));
    const r = await only(w, 'PAYMENT_PENDING_VERIFICATION');
    expect(keys(r)).toEqual(['PAYMENT_PENDING_VERIFICATION:p3']);
    expect(r.items[0]).toMatchObject({ days: -3, date: '2026-01-12' });
  });

  it('unallocated credit: 16 days yes, 15 no, balance 0.00 no, 0.01 yes; the amount is the unallocated part', async () => {
    const w = buildAlertsWorld();
    w.sources.payments.push(
      paymentRow('u16', 16, { status: 'CONFIRMADO', unallocated: '25.50' }),
      paymentRow('u15', 15, { status: 'CONFIRMADO', unallocated: '25.50' }),
      paymentRow('u0', 20, { status: 'CONFIRMADO', unallocated: '0.00' }),
      paymentRow('ucent', 20, { status: 'CONFIRMADO', unallocated: '0.01' }),
    );
    const r = await only(w, 'UNALLOCATED_CREDIT');
    expect(keys(r)).toEqual(['UNALLOCATED_CREDIT:u16', 'UNALLOCATED_CREDIT:ucent']);
    expect(r.items.find((i) => i.alertKey.endsWith('u16'))?.amount).toEqual({
      amount: '25.50',
      currency: 'USD',
    });
  });

  it('missing rate: a business day without a VES rate alerts, with a rate or on a weekend it does not', async () => {
    const w = buildAlertsWorld();
    expect((await only(w, 'MISSING_RATE')).items).toEqual([
      {
        alertKey: `MISSING_RATE:VES:${TODAY}`,
        type: 'MISSING_RATE',
        entity: null,
        date: TODAY,
        days: 0,
        amount: null,
        context: null,
      },
    ]);
    w.sources.vesRateDays.add(TODAY);
    expect((await only(w, 'MISSING_RATE')).items).toEqual([]);
    w.sources.vesRateDays.clear();
    w.clock.set('2026-01-17T15:00:00.000Z'); // Saturday
    expect((await only(w, 'MISSING_RATE')).items).toEqual([]);
  });

  it('boundaries move with the Caracas business day, not the UTC day', async () => {
    const w = buildAlertsWorld();
    w.sources.invoices.push(invoiceRow('d7', 7));
    w.clock.set('2026-01-16T02:00:00.000Z'); // still the 15th in Caracas (22:00)
    expect(keys(await only(w, 'INVOICE_DUE_SOON'))).toEqual(['INVOICE_DUE_SOON:d7']);
    w.clock.set('2026-01-16T05:00:00.000Z'); // the 16th in Caracas: day 6 away
    expect((await only(w, 'INVOICE_DUE_SOON')).items[0]?.days).toBe(6);
  });
});

describe('ListAlerts inbox', () => {
  const seeded = () => {
    const w = buildAlertsWorld();
    w.sources.invoices.push(
      invoiceRow('a', -1, { status: 'VENCIDA' }),
      invoiceRow('b', -2, { status: 'VENCIDA' }),
      invoiceRow('c', 3),
    );
    w.sources.documents.push(documentRow('doc', 5));
    return w;
  };

  it('total is not capped by limit; byType counts; most urgent first, then type, then key', async () => {
    const w = seeded();
    const all = await w.list.execute(owner, { limit: 50 });
    const capped = await w.list.execute(owner, { limit: 1 });
    expect(capped.total).toBe(all.total);
    expect(capped.items).toHaveLength(1);
    expect(all.byType).toEqual({
      INVOICE_OVERDUE: 2,
      INVOICE_DUE_SOON: 1,
      DOCUMENT_EXPIRING: 1,
      MISSING_RATE: 1,
    });
    expect(all.items.map((i) => i.alertKey)).toEqual([
      'INVOICE_OVERDUE:b',
      'INVOICE_OVERDUE:a',
      `MISSING_RATE:VES:${TODAY}`,
      'INVOICE_DUE_SOON:c',
      'DOCUMENT_EXPIRING:doc',
    ]);
  });

  it('breaks ties by type order and then by key', async () => {
    const w = buildAlertsWorld();
    w.sources.invoices.push(invoiceRow('z', 3), invoiceRow('m', 3));
    w.sources.documents.push(documentRow('doc', 3));
    const r = await w.list.execute(owner, { types: ['DOCUMENT_EXPIRING', 'INVOICE_DUE_SOON'] });
    expect(r.items.map((i) => i.alertKey)).toEqual([
      'INVOICE_DUE_SOON:m',
      'INVOICE_DUE_SOON:z',
      'DOCUMENT_EXPIRING:doc',
    ]);
  });

  it('Member and Viewer keep documents and get no finance type or rate; Admin sees the rate', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const w = seeded();
      const r = await w.list.execute(userOf(role), {});
      expect(Object.keys(r.byType)).toEqual(['DOCUMENT_EXPIRING']);
    }
    const w = seeded();
    const admin = await w.list.execute(userOf('ADMIN'), {});
    expect(admin.byType.MISSING_RATE).toBe(1);
  });

  it('asking for a hidden type answers an empty list, not an error (C14)', async () => {
    const w = seeded();
    const r = await w.list.execute(userOf('MEMBER'), { types: ['INVOICE_OVERDUE'] });
    expect(r).toEqual({ total: 0, byType: {}, items: [], unread: 0, readKeys: [] });
  });

  it('never reads a source of a type the caller cannot see', async () => {
    const w = seeded();
    let reads = 0;
    const spy = new Proxy(w.sources, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          reads += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const w2 = buildAlertsWorld(spy, w.states, w.clock);
    await w2.list.execute(userOf('VIEWER'), {});
    expect(reads).toBe(2); // documents expiring and expired only
  });

  it('a dismissal or snooze of one user does not affect another', async () => {
    const w = seeded();
    const other = userOf('ADMIN');
    await w.dismiss.execute(owner, { alertKey: 'INVOICE_OVERDUE:a' });
    expect((await w.list.execute(owner, { types: ['INVOICE_OVERDUE'] })).total).toBe(1);
    expect((await w.list.execute(other, { types: ['INVOICE_OVERDUE'] })).total).toBe(2);
  });

  it('a read alert stays listed and only leaves the unread counter, per user', async () => {
    const w = seeded();
    await w.markRead.execute(owner, { alertKeys: ['INVOICE_OVERDUE:a'] });
    const inbox = await w.list.execute(owner, { types: ['INVOICE_OVERDUE', 'INVOICE_DUE_SOON'] });
    expect(inbox.items.map((i) => i.alertKey)).toContain('INVOICE_OVERDUE:a');
    expect(inbox).toMatchObject({ total: 3, unread: 2, readKeys: ['INVOICE_OVERDUE:a'] });
    const other = await w.list.execute(userOf('ADMIN'), { types: ['INVOICE_OVERDUE'] });
    expect(other).toMatchObject({ unread: 2, readKeys: [] });
  });

  it('a row that only marks as read does not hide its alert (X3)', async () => {
    const w = seeded();
    await w.markRead.execute(owner, { alertKeys: ['INVOICE_OVERDUE:a'] });
    const row = w.states.rows.get(`${owner.userId}|INVOICE_OVERDUE:a`);
    expect(row).toMatchObject({ dismissedAt: null, dismissedUntil: null });
    expect((await w.list.execute(owner, { types: ['INVOICE_OVERDUE'] })).total).toBe(2);
  });

  it('a dismissed read alert counts nowhere', async () => {
    const w = seeded();
    await w.markRead.execute(owner, { alertKeys: ['INVOICE_OVERDUE:a', 'INVOICE_OVERDUE:a'] });
    await w.dismiss.execute(owner, { alertKey: 'INVOICE_OVERDUE:a' });
    expect(await w.list.execute(owner, { types: ['INVOICE_OVERDUE'] })).toMatchObject({
      total: 1,
      unread: 1,
      readKeys: [],
    });
  });
});

describe('ListAlerts input (carried: validated through its schema)', () => {
  it.each([0, -1, 201, 1.5, Number.NaN])('limit %s is VALIDATION', async (limit) => {
    const w = buildAlertsWorld();
    await expect(w.list.execute(owner, { limit })).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('an unknown type is VALIDATION with the key on types', async () => {
    const w = buildAlertsWorld();
    await expect(w.list.execute(owner, { types: ['NOPE'] })).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { types: ['alerts.validation.types'] },
    });
  });

  it('defaults to 50 and accepts 1 and 200', async () => {
    const w = buildAlertsWorld();
    for (let i = 0; i < 60; i += 1)
      w.sources.invoices.push(invoiceRow(`i${i}`, -1, { status: 'VENCIDA' }));
    expect((await w.list.execute(owner, {})).items).toHaveLength(50);
    expect((await w.list.execute(owner, { limit: 1 })).items).toHaveLength(1);
    expect((await w.list.execute(owner, { limit: 200 })).items).toHaveLength(61);
  });

  it('repeated types count once', async () => {
    const w = buildAlertsWorld();
    w.sources.invoices.push(invoiceRow('a', -1, { status: 'VENCIDA' }));
    const r = await w.list.execute(owner, { types: ['INVOICE_OVERDUE', 'INVOICE_OVERDUE'] });
    expect(r.total).toBe(1);
  });
});
