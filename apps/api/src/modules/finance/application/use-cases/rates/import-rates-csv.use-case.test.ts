import { describe, expect, it } from 'vitest';
import { createWorld, rate, rejection } from '../../../../../../test/finance/rates/world';

describe('ImportRatesCsv (ported from importRatesCsv, PRD §8.15)', () => {
  it('creates, skips existing keys unless overwrite, and reports unknown currencies by row', async () => {
    const w = createWorld();
    w.repository.seed(rate('2026-10-12', 'VES', '700', 'BCV'));
    const rows = [
      { date: '2026-10-12', currency: 'VES', usdRate: '757.5', source: 'BCV' as const },
      { date: '2026-10-12', currency: 'EUR', usdRate: '0.86', source: 'MANUAL' as const },
      { date: '2026-10-12', currency: 'ABC', usdRate: '3', source: 'MANUAL' as const },
    ];
    const first = await w.importCsv.execute(w.owner, { rows, overwrite: false });
    expect(first).toEqual({
      created: 1,
      updated: 0,
      skipped: 1,
      errors: [{ row: 3, messages: ['catalogs.rates.errors.unknownCurrency'] }],
    });
    expect(w.repository.all.find((r) => r.currency === 'VES')?.usdRate).toBe('700');

    const second = await w.importCsv.execute(w.admin, { rows, overwrite: true });
    expect(second).toMatchObject({ created: 0, updated: 2, skipped: 0 });
    expect(w.repository.all.find((r) => r.currency === 'VES')?.usdRate).toBe('757.5');
    expect(w.activity.entries.map((e) => e.changes)).toEqual([
      { ratesImported: [null, '1'] },
      { ratesImported: [null, '2'] },
    ]);
  });

  it('treats a repeated key inside the file as a later row over an earlier one', async () => {
    const w = createWorld();
    const row = (usdRate: string) => ({
      date: '2026-10-12',
      currency: 'VES',
      usdRate,
      source: 'MANUAL' as const,
    });
    const skipped = await w.importCsv.execute(w.owner, {
      rows: [row('1'), row('2')],
      overwrite: false,
    });
    expect(skipped).toMatchObject({ created: 1, skipped: 1 });
    expect(w.repository.all[0]?.usdRate).toBe('1');
  });

  it('logs nothing when no row was written', async () => {
    const w = createWorld();
    const result = await w.importCsv.execute(w.owner, {
      rows: [{ date: '2026-10-12', currency: 'ABC', usdRate: '3', source: 'MANUAL' }],
      overwrite: false,
    });
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 0 });
    expect(w.activity.entries).toHaveLength(0);
  });

  it('reports a USD row, a bad rate and a bad date by row and imports the rest', async () => {
    const w = createWorld();
    const result = await w.importCsv.execute(w.owner, {
      rows: [
        { date: '2026-10-12', currency: 'USD', usdRate: '1', source: 'MANUAL' },
        { date: '2026-10-12', currency: 'VES', usdRate: '-5', source: 'MANUAL' },
        { date: '2026-99-12', currency: 'VES', usdRate: '5', source: 'MANUAL' },
        { date: '2026-10-12', currency: 'EUR', usdRate: '0.9', source: 'MANUAL' },
      ],
      overwrite: false,
    });
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      { row: 1, messages: ['catalogs.validation.rateCurrencyIsUsd'] },
      { row: 2, messages: ['validation.rate.invalid'] },
      { row: 3, messages: ['validation.date.invalid'] },
    ]);
  });

  it('refuses an empty file, and Member and Viewer get FORBIDDEN', async () => {
    const w = createWorld();
    const empty = await rejection(w.importCsv.execute(w.owner, { rows: [], overwrite: false }));
    expect(empty.fieldErrors).toEqual({ rows: ['validation.required'] });
    for (const user of [w.member, w.viewer]) {
      const error = await rejection(
        w.importCsv.execute(user, {
          rows: [{ date: '2026-10-12', currency: 'VES', usdRate: '5', source: 'MANUAL' }],
          overwrite: false,
        }),
      );
      expect(error.code).toBe('FORBIDDEN');
    }
  });
});
