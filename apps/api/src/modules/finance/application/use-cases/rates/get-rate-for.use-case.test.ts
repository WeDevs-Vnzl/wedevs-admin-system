import { describe, expect, it } from 'vitest';
import { createWorld, rate } from '../../../../../../test/finance/rates/world';

const seeded = () => {
  const w = createWorld();
  w.repository.seed(rate('2026-10-09', 'VES', '755.16', 'BCV', '2026-10-09T10:00:00.000Z'));
  w.repository.seed(rate('2026-10-09', 'VES', '760', 'OTRA', '2026-10-09T11:00:00.000Z'));
  w.repository.seed(rate('2026-10-01', 'VES', '700', 'BCV'));
  return w;
};

describe('GetRateFor (ported from getRateFor, DT-67)', () => {
  it('returns the rate of the exact date, BCV first, with every source as an option', async () => {
    const w = seeded();
    const found = await w.getRateFor.execute(w.viewer, { date: '2026-10-09', currency: 'VES' });
    expect(found).toMatchObject({
      usdRate: '755.16',
      source: 'BCV',
      isFallback: false,
      effectiveDate: '2026-10-09',
    });
    expect(found?.options.map((o) => o.source)).toEqual(['BCV', 'OTRA']);
    expect(found?.options[0]?.usdRate).toBe(found?.usdRate);
  });

  it('falls back to the latest earlier date and flags it', async () => {
    const w = seeded();
    expect(
      await w.getRateFor.execute(w.viewer, { date: '2026-10-05', currency: 'VES' }),
    ).toMatchObject({ isFallback: true, effectiveDate: '2026-10-01', usdRate: '700' });
  });

  it('falls back to the latest stored date when the requested one is after it', async () => {
    const w = seeded();
    expect(
      await w.getRateFor.execute(w.viewer, { date: '2026-10-20', currency: 'VES' }),
    ).toMatchObject({ isFallback: true, effectiveDate: '2026-10-09' });
  });

  it('returns null when there is no rate on or before the date or the currency has none', async () => {
    const w = seeded();
    expect(
      await w.getRateFor.execute(w.viewer, { date: '2025-01-01', currency: 'VES' }),
    ).toBeNull();
    expect(
      await w.getRateFor.execute(w.viewer, { date: '2026-10-09', currency: 'ABC' }),
    ).toBeNull();
  });

  it('answers USD as exactly 1 with no source and no options', async () => {
    const w = seeded();
    expect(await w.getRateFor.execute(w.viewer, { date: '2026-10-09', currency: 'USD' })).toEqual({
      usdRate: '1',
      source: null,
      isFallback: false,
      effectiveDate: '2026-10-09',
      options: [],
    });
  });

  it('sees a rate stored after the source was built', async () => {
    const w = seeded();
    w.repository.seed(rate('2026-10-12', 'VES', '760.5', 'MANUAL', '2026-10-12T09:00:00.000Z'));
    expect(await w.source.getRateFor('2026-10-12', 'VES')).toMatchObject({
      usdRate: '760.5',
      source: 'MANUAL',
      isFallback: false,
    });
  });

  it('answers a malformed date or currency as VALIDATION', async () => {
    const w = seeded();
    await expect(
      w.getRateFor.execute(w.viewer, { date: '2026-13-40', currency: 'VES' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { date: ['validation.date.invalid'] },
    });
    await expect(
      w.getRateFor.execute(w.viewer, { date: '2026-10-09', currency: 'ves' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { currency: ['validation.currency.invalid'] },
    });
  });
});
