import { describe, expect, it } from 'vitest';
import { createWorld, query, rate, rejection } from '../../../../../../test/finance/rates/world';

const seeded = () => {
  const w = createWorld();
  w.repository.seed(rate('2026-10-09', 'VES', '755.16', 'BCV'));
  w.repository.seed(rate('2026-10-09', 'VES', '760', 'OTRA'));
  w.repository.seed(rate('2026-10-09', 'EUR', '0.86', 'MANUAL'));
  w.repository.seed(rate('2026-10-01', 'VES', '700', 'BCV'));
  return w;
};

describe('ListExchangeRates (ported from listExchangeRates)', () => {
  it('lists the rates newest date first', async () => {
    const w = seeded();
    const page = await w.listRates.execute(w.owner, query());
    expect(page.total).toBe(4);
    expect(page.items[0]?.date).toBe('2026-10-09');
    expect(page.items.at(-1)?.date).toBe('2026-10-01');
  });

  it('filters by currency, source and date range', async () => {
    const w = seeded();
    const byCurrency = await w.listRates.execute(w.owner, query({ filters: { currency: 'VES' } }));
    expect(byCurrency.items.every((row) => row.currency === 'VES')).toBe(true);
    expect(byCurrency.total).toBe(3);
    const bySource = await w.listRates.execute(w.owner, query({ filters: { source: 'OTRA' } }));
    expect(bySource.items.map((row) => row.usdRate)).toEqual(['760']);
    const several = await w.listRates.execute(
      w.admin,
      query({ filters: { currency: ['VES', 'EUR'], source: ['BCV', 'MANUAL'] } }),
    );
    expect(several.total).toBe(3);
    const ranged = await w.listRates.execute(
      w.owner,
      query({ filters: { dateFrom: '2026-10-02', dateTo: '2026-10-31' } }),
    );
    expect(ranged.total).toBe(3);
  });

  it('sorts by the requested whitelisted field', async () => {
    const w = seeded();
    const page = await w.listRates.execute(
      w.owner,
      query({ sort: { field: 'usdRate', direction: 'asc' } }),
    );
    expect(page.items.map((row) => row.usdRate)).toEqual(['0.86', '700', '755.16', '760']);
  });

  it('is limited to the settings read grant: Member and Viewer get FORBIDDEN', async () => {
    const w = seeded();
    for (const user of [w.member, w.viewer]) {
      expect((await rejection(w.listRates.execute(user, query()))).code).toBe('FORBIDDEN');
    }
    expect((await w.listRates.execute(w.admin, query())).total).toBe(4);
  });

  it('answers a malformed filter value as VALIDATION', async () => {
    const w = seeded();
    const error = await rejection(
      w.listRates.execute(w.owner, query({ filters: { dateFrom: '2026-02-31' } })),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { dateFrom: ['validation.date.invalid'] },
    });
  });
});
