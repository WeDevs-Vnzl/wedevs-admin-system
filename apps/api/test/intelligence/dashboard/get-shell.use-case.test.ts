import { beforeEach, describe, expect, it } from 'vitest';
import { invoiceRow } from '../alerts/alerts-world';
import { buildDashboardWorld, TODAY, userOf, type DashboardWorld } from './dashboard-world';

describe('GetShell', () => {
  let world: DashboardWorld;
  beforeEach(() => {
    world = buildDashboardWorld();
    world.sources.vesRateDays.add(TODAY);
  });

  it('returns the caller and the bell counters through ListAlerts with limit 1', async () => {
    world.sources.invoices.push(
      invoiceRow('i1', -3, { status: 'VENCIDA' }),
      invoiceRow('i2', -5, { status: 'VENCIDA' }),
      invoiceRow('i3', 2),
    );
    const out = await world.shell.execute(userOf('OWNER'));
    expect(out.user).toEqual({
      id: 'usr_owner',
      name: 'usr_owner',
      email: 'usr_owner@example.test',
      role: 'OWNER',
    });
    // total and byType count every alert although only one item is requested
    expect(out.alerts).toEqual({
      total: 3,
      unread: 3,
      byType: { INVOICE_OVERDUE: 2, INVOICE_DUE_SOON: 1 },
    });
  });

  it('counts a read alert in total but not in unread, and drops a dismissed one', async () => {
    world.sources.invoices.push(
      invoiceRow('i1', -3, { status: 'VENCIDA' }),
      invoiceRow('i2', -5, { status: 'VENCIDA' }),
    );
    const owner = userOf('OWNER');
    const at = new Date('2026-01-14T00:00:00Z');
    await world.states.markRead(owner.userId, ['INVOICE_OVERDUE:i1'], at);
    await world.states.hide(owner.userId, 'INVOICE_OVERDUE:i2', {
      dismissedAt: at,
      dismissedUntil: null,
    });
    expect((await world.shell.execute(owner)).alerts).toEqual({
      total: 1,
      unread: 0,
      byType: { INVOICE_OVERDUE: 1 },
    });
  });

  it('a Viewer gets no financial alert type in its counters (C13)', async () => {
    world.sources.invoices.push(invoiceRow('i1', -3, { status: 'VENCIDA' }));
    const out = await world.shell.execute(userOf('VIEWER'));
    expect(out.alerts).toEqual({ total: 0, unread: 0, byType: {} });
  });

  it('shows the VES rate of today without a warning', async () => {
    const out = await world.shell.execute(userOf('MEMBER'));
    expect(out.vesRate).toEqual({ date: TODAY, usdRate: '36.5', source: 'BCV' });
    expect(out.vesRateMissing).toBe(false);
    expect(world.rates.calls).toContain(`${TODAY}:VES`);
  });

  it('warns when a business day only has an earlier rate, and shows that rate', async () => {
    world.rates.rates.set('VES', { usdRate: '35.9', fallbackFrom: '2026-01-13' });
    const out = await world.shell.execute(userOf('OWNER'));
    expect(out.vesRate).toEqual({ date: '2026-01-13', usdRate: '35.9', source: 'BCV' });
    expect(out.vesRateMissing).toBe(true);
  });

  it('does not warn on a weekend with the last rate (no rate is published then)', async () => {
    world.clock.set('2026-01-17T16:00:00.000Z'); // Saturday in Caracas
    world.rates.rates.set('VES', { usdRate: '35.9', fallbackFrom: '2026-01-16' });
    const out = await world.shell.execute(userOf('OWNER'));
    expect(out.vesRateMissing).toBe(false);
  });

  it('answers a null chip and a warning when no rate exists at all', async () => {
    world.rates.rates.delete('VES');
    const out = await world.shell.execute(userOf('OWNER'));
    expect(out.vesRate).toBeNull();
    expect(out.vesRateMissing).toBe(true);
  });
});
