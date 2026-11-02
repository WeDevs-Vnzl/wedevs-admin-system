import { describe, expect, it } from 'vitest';
import type { ExchangePort } from '../../../src/modules/integrations/application/ports/exchange.port';

export interface ExchangeHarness {
  readonly port: ExchangePort;
  /** Deposits strictly before / at-or-after `cutoff` that the scripted account holds. */
  readonly cutoff: Date;
  readonly depositsBeforeCutoff: number;
  readonly depositsFromCutoff: number;
}

const DECIMAL = /^\d+(\.\d+)?$/;

/** Contract of `ExchangePort` (A7): read-only, amounts as strings, deposits filtered by `since`. */
export function exchangeContract(
  name: string,
  factory: () => Promise<ExchangeHarness> | ExchangeHarness,
): void {
  describe(`ExchangePort contract: ${name}`, () => {
    it('returns balances with string amounts', async () => {
      const h = await factory();
      const balances = await h.port.balances();
      expect(balances.length).toBeGreaterThan(0);
      for (const row of balances) {
        expect(row.asset.length).toBeGreaterThan(0);
        expect(row.free).toMatch(DECIMAL);
        expect(row.locked).toMatch(DECIMAL);
      }
    });

    it('returns the deposits from the cutoff, oldest first', async () => {
      const h = await factory();
      const deposits = await h.port.deposits(h.cutoff);
      expect(deposits).toHaveLength(h.depositsFromCutoff);
      for (const row of deposits) {
        expect(row.insertedAt.getTime()).toBeGreaterThanOrEqual(h.cutoff.getTime());
        expect(row.amount).toMatch(DECIMAL);
      }
      const times = deposits.map((row) => row.insertedAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it('returns every deposit from the epoch and none from the far future', async () => {
      const h = await factory();
      const all = await h.port.deposits(new Date(0));
      expect(all).toHaveLength(h.depositsBeforeCutoff + h.depositsFromCutoff);
      expect(await h.port.deposits(new Date('2999-01-01T00:00:00Z'))).toEqual([]);
    });
  });
}
