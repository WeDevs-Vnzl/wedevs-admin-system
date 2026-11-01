import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationFailedError } from '../../../src/shared/domain/domain-error';
import { buildAlertsWorld, invoiceRow, userOf } from './alerts-world';

const owner = userOf('OWNER');
const KEY = 'INVOICE_OVERDUE:a';
const DAY = 86_400_000;

const setup = () => {
  const w = buildAlertsWorld();
  w.sources.invoices.push(invoiceRow('a', -1, { status: 'VENCIDA' }));
  return w;
};
const rowOf = (w: ReturnType<typeof setup>, user = owner, key = KEY) =>
  w.states.rows.get(`${user.userId}|${key}`);

describe('DismissAlert', () => {
  it('without days dismisses for good: sets dismissedAt, clears dismissedUntil', async () => {
    const w = setup();
    expect(await w.dismiss.execute(owner, { alertKey: KEY })).toEqual({
      alertKey: KEY,
      dismissedUntil: null,
      active: false,
    });
    expect(rowOf(w)).toMatchObject({ dismissedAt: w.clock.now(), dismissedUntil: null });
    expect((await w.list.execute(owner, { types: ['INVOICE_OVERDUE'] })).total).toBe(0);
  });

  it('with days snoozes: sets dismissedUntil = now + days, clears dismissedAt, and the alert returns after', async () => {
    const w = setup();
    const view = await w.dismiss.execute(owner, { alertKey: KEY, days: 3 });
    expect(view).toEqual({
      alertKey: KEY,
      dismissedUntil: new Date(w.clock.now().getTime() + 3 * DAY).toISOString(),
      active: false,
    });
    expect(rowOf(w)).toMatchObject({ dismissedAt: null });
    expect((await w.list.execute(owner, { types: ['INVOICE_OVERDUE'] })).total).toBe(0);
    w.clock.advance(3 * DAY - 1);
    expect((await w.list.execute(owner, { types: ['INVOICE_OVERDUE'] })).total).toBe(0);
    w.clock.advance(2);
    expect((await w.list.execute(owner, { types: ['INVOICE_OVERDUE'] })).total).toBe(1);
  });

  it('snoozing a dismissed alert, and dismissing a snoozed one, swaps the columns', async () => {
    const w = setup();
    await w.dismiss.execute(owner, { alertKey: KEY });
    await w.dismiss.execute(owner, { alertKey: KEY, days: 1 });
    expect(rowOf(w)).toMatchObject({ dismissedAt: null });
    expect(rowOf(w)?.dismissedUntil).not.toBeNull();
    await w.dismiss.execute(owner, { alertKey: KEY });
    expect(rowOf(w)).toMatchObject({ dismissedUntil: null });
    expect(rowOf(w)?.dismissedAt).not.toBeNull();
    expect(w.states.rows.size).toBe(1);
  });

  it.each([0, 91, -1, 1.5])('days %s is VALIDATION and writes nothing', async (days) => {
    const w = setup();
    await expect(w.dismiss.execute(owner, { alertKey: KEY, days })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(w.states.rows.size).toBe(0);
  });

  it('accepts 1 and 90 days', async () => {
    const w = setup();
    await w.dismiss.execute(owner, { alertKey: KEY, days: 1 });
    await w.dismiss.execute(owner, { alertKey: KEY, days: 90 });
    expect(rowOf(w)?.dismissedUntil?.getTime()).toBe(w.clock.now().getTime() + 90 * DAY);
  });

  it('a malformed key is VALIDATION', async () => {
    const w = setup();
    for (const alertKey of ['nope', 'INVOICE_OVERDUE', 'UNKNOWN_TYPE:x', 'INVOICE_OVERDUE:a b']) {
      await expect(w.dismiss.execute(owner, { alertKey })).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { alertKey: ['alerts.validation.alertKey'] },
      });
    }
  });

  it('A8: a type the caller cannot see is NOT_FOUND and writes nothing; a vanished subject is fine', async () => {
    const w = setup();
    await expect(w.dismiss.execute(userOf('MEMBER'), { alertKey: KEY })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      w.dismiss.execute(userOf('VIEWER'), { alertKey: 'MISSING_RATE:VES:2026-01-15' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(w.states.rows.size).toBe(0);
    await expect(
      w.dismiss.execute(owner, { alertKey: 'INVOICE_OVERDUE:long_gone' }),
    ).resolves.toMatchObject({ active: false });
  });
});

describe('RestoreAlert', () => {
  it('clears both columns, keeps readAt, and the alert is back', async () => {
    const w = setup();
    await w.markRead.execute(owner, { alertKeys: [KEY] });
    await w.dismiss.execute(owner, { alertKey: KEY });
    expect(await w.restore.execute(owner, { alertKey: KEY })).toEqual({
      alertKey: KEY,
      dismissedUntil: null,
      active: true,
    });
    expect(rowOf(w)).toMatchObject({ dismissedAt: null, dismissedUntil: null });
    expect(rowOf(w)?.readAt).not.toBeNull();
    expect(await w.list.execute(owner, { types: ['INVOICE_OVERDUE'] })).toMatchObject({
      total: 1,
      readKeys: [KEY],
    });
  });

  it('touches only the caller row and is a no-op without one', async () => {
    const w = setup();
    const admin = userOf('ADMIN');
    await w.dismiss.execute(owner, { alertKey: KEY });
    await w.dismiss.execute(admin, { alertKey: KEY });
    await w.restore.execute(owner, { alertKey: KEY });
    expect(rowOf(w, admin)?.dismissedAt).not.toBeNull();
    await expect(
      w.restore.execute(owner, { alertKey: 'INVOICE_OVERDUE:none' }),
    ).resolves.toMatchObject({
      active: true,
    });
    expect(w.states.rows.size).toBe(2);
  });

  it('applies A8: invisible type is NOT_FOUND, malformed key VALIDATION', async () => {
    const w = setup();
    await expect(w.restore.execute(userOf('VIEWER'), { alertKey: KEY })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(w.restore.execute(owner, { alertKey: 'x' })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });
});

describe('MarkAlertsRead', () => {
  it('is idempotent, answers the deduplicated keys and keeps the first readAt', async () => {
    const w = setup();
    expect(await w.markRead.execute(owner, { alertKeys: [KEY, KEY] })).toEqual({
      alertKeys: [KEY],
    });
    const first = rowOf(w)?.readAt;
    w.clock.advance(DAY);
    await w.markRead.execute(owner, { alertKeys: [KEY] });
    expect(rowOf(w)?.readAt).toEqual(first);
    expect(w.states.rows.size).toBe(1);
  });

  it('rejects an empty batch, more than 200 keys and a malformed key (VALIDATION)', async () => {
    const w = setup();
    const many = Array.from({ length: 201 }, (_, i) => `INVOICE_OVERDUE:i${i}`);
    for (const alertKeys of [[], many, [KEY, 'bad key']]) {
      await expect(w.markRead.execute(owner, { alertKeys })).rejects.toBeInstanceOf(
        ValidationFailedError,
      );
    }
    expect(w.states.rows.size).toBe(0);
  });

  it('accepts exactly 200 keys', async () => {
    const w = setup();
    const keys = Array.from({ length: 200 }, (_, i) => `INVOICE_OVERDUE:i${i}`);
    expect((await w.markRead.execute(owner, { alertKeys: keys })).alertKeys).toHaveLength(200);
  });

  it('one invisible type fails the whole batch with NOT_FOUND and writes nothing', async () => {
    const w = setup();
    await expect(
      w.markRead.execute(userOf('MEMBER'), { alertKeys: ['DOCUMENT_EXPIRING:d', KEY] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(w.states.rows.size).toBe(0);
  });
});
