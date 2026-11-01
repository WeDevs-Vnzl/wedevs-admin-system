import { describe, expect, it } from 'vitest';
import { createWorld, rate, rejection } from '../../../../../../test/finance/rates/world';

describe('LoadDailyRates (ported from loadDailyRates, PRD §8.15)', () => {
  it('saves several currencies for one date and source and logs one activity', async () => {
    const w = createWorld();
    const result = await w.loadDaily.execute(w.owner, {
      date: '2026-10-12',
      source: 'MANUAL',
      rates: [
        { currency: 'VES', usdRate: '757.5' },
        { currency: 'EUR', usdRate: '0.861' },
      ],
    });
    expect(result).toEqual({ created: 2, updated: 0 });
    expect(w.repository.all).toHaveLength(2);
    expect(await w.source.getRateFor('2026-10-12', 'VES')).toMatchObject({ usdRate: '757.5' });
    expect(w.activity.entries).toEqual([
      expect.objectContaining({
        action: 'SETTINGS_CHANGE',
        entityId: 'rates-2026-10-12',
        changes: { 'rates.MANUAL': [null, 'EUR, VES'] },
      }),
    ]);

    const replay = await w.loadDaily.execute(w.admin, {
      date: '2026-10-12',
      source: 'MANUAL',
      rates: [{ currency: 'VES', usdRate: '758' }],
    });
    expect(replay).toEqual({ created: 0, updated: 1 });
    expect(w.repository.all).toHaveLength(2);
  });

  it('refuses the whole batch when one currency is unknown, writing nothing', async () => {
    const w = createWorld();
    const error = await rejection(
      w.loadDaily.execute(w.owner, {
        date: '2026-10-12',
        source: 'MANUAL',
        rates: [
          { currency: 'VES', usdRate: '757.5' },
          { currency: 'ABC', usdRate: '3' },
        ],
      }),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { 'rates.1.currency': ['catalogs.rates.errors.unknownCurrency'] },
    });
    expect(w.repository.all).toHaveLength(0);
    expect(w.activity.entries).toHaveLength(0);
  });

  it('refuses a repeated currency, USD and a bad rate with the row path', async () => {
    const w = createWorld();
    const error = await rejection(
      w.loadDaily.execute(w.owner, {
        date: '2026-10-12',
        source: 'MANUAL',
        rates: [
          { currency: 'VES', usdRate: '1' },
          { currency: 'VES', usdRate: '2' },
          { currency: 'USD', usdRate: '1' },
          { currency: 'EUR', usdRate: '0' },
        ],
      }),
    );
    expect(error.fieldErrors).toEqual({
      'rates.1.currency': ['catalogs.validation.duplicateRateCurrency'],
      'rates.2.currency': ['catalogs.validation.rateCurrencyIsUsd'],
      'rates.3.usdRate': ['validation.rate.mustBePositive'],
    });
    expect(w.repository.all).toHaveLength(0);
  });

  it('rolls every row back when the activity cannot be written (all or nothing)', async () => {
    const w = createWorld();
    w.repository.seed(rate('2026-10-12', 'VES', '1', 'MANUAL'));
    w.activity.record = () => Promise.reject(new Error('activity down'));
    await expect(
      w.loadDaily.execute(w.owner, {
        date: '2026-10-12',
        source: 'MANUAL',
        rates: [
          { currency: 'VES', usdRate: '9' },
          { currency: 'EUR', usdRate: '2' },
        ],
      }),
    ).rejects.toThrow('activity down');
    expect(w.repository.all.map((row) => row.usdRate)).toEqual(['1']);
  });

  it('refuses an empty batch and needs the settings update grant', async () => {
    const w = createWorld();
    const empty = await rejection(
      w.loadDaily.execute(w.owner, { date: '2026-10-12', source: 'MANUAL', rates: [] }),
    );
    expect(empty.fieldErrors).toEqual({ rates: ['validation.required'] });
    const denied = await rejection(
      w.loadDaily.execute(w.member, {
        date: '2026-10-12',
        source: 'MANUAL',
        rates: [{ currency: 'VES', usdRate: '5' }],
      }),
    );
    expect(denied.code).toBe('FORBIDDEN');
  });
});
