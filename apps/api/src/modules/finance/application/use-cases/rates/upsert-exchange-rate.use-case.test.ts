import { describe, expect, it } from 'vitest';
import { createWorld, NOW, rate, rejection } from '../../../../../../test/finance/rates/world';

describe('UpsertExchangeRate (ported from upsertExchangeRate, DT-67)', () => {
  it('keeps one rate per date, currency and source: a new source adds, the same source updates', async () => {
    const w = createWorld();
    const manual = await w.upsert.execute(w.owner, {
      date: '2026-10-12',
      currency: 'VES',
      usdRate: '760.10',
      source: 'MANUAL',
    });
    expect(manual).toMatchObject({
      created: true,
      rate: { usdRate: '760.10', source: 'MANUAL', createdById: w.owner.userId, createdAt: NOW },
    });
    const again = await w.upsert.execute(w.admin, {
      date: '2026-10-12',
      currency: 'VES',
      usdRate: '761',
      source: 'MANUAL',
    });
    expect(again).toMatchObject({ created: false, rate: { id: manual.rate.id, usdRate: '761' } });
    expect(again.rate.createdById).toBe(w.owner.userId);
    expect(w.repository.all).toHaveLength(1);

    await w.upsert.execute(w.owner, {
      date: '2026-10-12',
      currency: 'VES',
      usdRate: '762',
      source: 'BCV',
    });
    expect(w.repository.all).toHaveLength(2);
    expect(await w.source.getRateFor('2026-10-12', 'VES')).toMatchObject({
      source: 'BCV',
      usdRate: '762',
    });
  });

  it('refuses a currency that is not in the catalog and writes nothing', async () => {
    const w = createWorld();
    const error = await rejection(
      w.upsert.execute(w.owner, {
        date: '2026-10-12',
        currency: 'ABC',
        usdRate: '2',
        source: 'MANUAL',
      }),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { currency: ['catalogs.rates.errors.unknownCurrency'] },
    });
    expect(w.repository.all).toHaveLength(0);
    expect(w.activity.entries).toHaveLength(0);
  });

  it('refuses USD, a non-positive rate and a malformed date as VALIDATION', async () => {
    const w = createWorld();
    const usd = await rejection(
      w.upsert.execute(w.owner, {
        date: '2026-10-12',
        currency: 'USD',
        usdRate: '1',
        source: 'MANUAL',
      }),
    );
    expect(usd.fieldErrors).toEqual({ currency: ['catalogs.validation.rateCurrencyIsUsd'] });
    const zero = await rejection(
      w.upsert.execute(w.owner, {
        date: '2026-10-12',
        currency: 'VES',
        usdRate: '0',
        source: 'MANUAL',
      }),
    );
    expect(zero.fieldErrors).toEqual({ usdRate: ['validation.rate.mustBePositive'] });
    const garbage = await rejection(
      w.upsert.execute(w.owner, {
        date: '2026-10-12',
        currency: 'VES',
        usdRate: '1e3',
        source: 'MANUAL',
      }),
    );
    expect(garbage.fieldErrors).toEqual({ usdRate: ['validation.rate.invalid'] });
    const date = await rejection(
      w.upsert.execute(w.owner, {
        date: '2026-02-30',
        currency: 'VES',
        usdRate: '5',
        source: 'MANUAL',
      }),
    );
    expect(date.fieldErrors).toEqual({ date: ['validation.date.invalid'] });
    expect(w.repository.all).toHaveLength(0);
  });

  it('flags a rate that differs more than 10 % from the latest earlier one (PRD §15)', async () => {
    const w = createWorld();
    w.repository.seed(rate('2026-10-09', 'VES', '100', 'BCV'));
    const near = await w.upsert.execute(w.owner, {
      date: '2026-10-12',
      currency: 'VES',
      usdRate: '110',
      source: 'MANUAL',
    });
    expect(near.deviationExceeded).toBe(false);
    const far = await w.upsert.execute(w.owner, {
      date: '2026-10-13',
      currency: 'VES',
      usdRate: '120.01',
      source: 'MANUAL',
    });
    expect(far.deviationExceeded).toBe(false);
    const jump = await w.upsert.execute(w.owner, {
      date: '2026-10-14',
      currency: 'VES',
      usdRate: '200',
      source: 'MANUAL',
    });
    expect(jump.deviationExceeded).toBe(true);
    const first = await w.upsert.execute(w.owner, {
      date: '2026-10-12',
      currency: 'EUR',
      usdRate: '0.9',
      source: 'MANUAL',
    });
    expect(first.deviationExceeded).toBe(false);
  });

  it('logs one SETTINGS_CHANGE in the same unit of work and none when the write fails', async () => {
    const w = createWorld();
    const saved = await w.upsert.execute(w.owner, {
      date: '2026-10-12',
      currency: 'VES',
      usdRate: '760',
      source: 'BCV',
    });
    expect(w.activity.entries).toEqual([
      expect.objectContaining({
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: saved.rate.id,
        entityLabel: 'VES 2026-10-12',
        changes: { 'rate.BCV': [null, '760'] },
        actor: { actorType: 'USER', userId: w.owner.userId },
      }),
    ]);
  });

  it('rolls the rate back when the activity cannot be written', async () => {
    const w = createWorld();
    w.activity.record = () => Promise.reject(new Error('activity down'));
    await expect(
      w.upsert.execute(w.owner, {
        date: '2026-10-12',
        currency: 'VES',
        usdRate: '5',
        source: 'MANUAL',
      }),
    ).rejects.toThrow('activity down');
    expect(w.repository.all).toHaveLength(0);
  });

  it('needs the settings update grant: Member and Viewer get FORBIDDEN and nothing changes', async () => {
    const w = createWorld();
    for (const user of [w.member, w.viewer]) {
      const error = await rejection(
        w.upsert.execute(user, {
          date: '2026-10-12',
          currency: 'VES',
          usdRate: '5',
          source: 'MANUAL',
        }),
      );
      expect(error.code).toBe('FORBIDDEN');
    }
    expect(w.repository.all).toHaveLength(0);
  });
});
