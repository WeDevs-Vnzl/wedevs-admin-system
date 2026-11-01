import { beforeEach, describe, expect, it } from 'vitest';
import { FACT_KINDS } from '../../../src/modules/intelligence/application/ports/finance-facts-read.port';
import type { FinanceFactsReadPort } from '../../../src/modules/intelligence/application/ports/finance-facts-read.port';
import type { SeedFact } from '../fakes/in-memory-finance-facts-read';

export interface FinanceFactsHarness {
  readonly port: FinanceFactsReadPort;
  addFact(fact: SeedFact): Promise<void>;
  /** Creates the tag and its assignments on these clients and projects. */
  tag(tagId: string, assigned: { clientIds?: string[]; projectIds?: string[] }): Promise<void>;
  addCategory(id: string, parentId?: string | null): Promise<void>;
}

const ZERO = '0.00';
const june = { from: '2026-06-01', to: '2026-06-30' };

/** Contract of `FinanceFactsReadPort` (DT-125, DT-170): the fake and the Prisma adapter both pass it. */
export function financeFactsReadContract(
  name: string,
  factory: () => Promise<FinanceFactsHarness> | FinanceFactsHarness,
): void {
  describe(`FinanceFactsReadPort contract: ${name}`, () => {
    let h: FinanceFactsHarness;
    beforeEach(async () => {
      h = await factory();
    });

    describe('sumByKind', () => {
      it('lists every kind as zero when there are no facts', async () => {
        const sums = await h.port.sumByKind(june);
        expect(Object.keys(sums).sort()).toEqual([...FACT_KINDS].sort());
        expect(Object.values(sums).every((value) => value === ZERO)).toBe(true);
      });

      it('sums by kind over an inclusive range and ignores other dates', async () => {
        await h.addFact({ kind: 'BILLED', date: '2026-06-01', amountUsd: '100.00' });
        await h.addFact({ kind: 'BILLED', date: '2026-06-30', amountUsd: '50.00' });
        await h.addFact({ kind: 'BILLED', date: '2026-05-31', amountUsd: '999.00' });
        await h.addFact({ kind: 'BILLED', date: '2026-07-01', amountUsd: '999.00' });
        await h.addFact({ kind: 'EXPENSE_PAID', date: '2026-06-15', amountUsd: '20.50' });
        const sums = await h.port.sumByKind(june);
        expect(sums.BILLED).toBe('150.00');
        expect(sums.EXPENSE_PAID).toBe('20.50');
        expect(sums.COLLECTED).toBe(ZERO);
      });

      it('keeps a 0.1 + 0.2 style sum exact and carries a very large one without a float', async () => {
        await h.addFact({ kind: 'COLLECTED', date: '2026-06-02', amountUsd: '0.10' });
        await h.addFact({ kind: 'COLLECTED', date: '2026-06-03', amountUsd: '0.20' });
        expect((await h.port.sumByKind(june)).COLLECTED).toBe('0.30');
        await h.addFact({ kind: 'BILLED', date: '2026-06-02', amountUsd: '9999999999999999.98' });
        await h.addFact({ kind: 'BILLED', date: '2026-06-03', amountUsd: '0.01' });
        expect((await h.port.sumByKind(june)).BILLED).toBe('9999999999999999.99');
      });

      it('adds signed adjustments (a negative MOVEMENT_IN)', async () => {
        await h.addFact({ kind: 'MOVEMENT_IN', date: '2026-06-02', amountUsd: '100.00' });
        await h.addFact({ kind: 'MOVEMENT_IN', date: '2026-06-03', amountUsd: '-30.00' });
        expect((await h.port.sumByKind(june)).MOVEMENT_IN).toBe('70.00');
      });

      it('narrows by client, by project and by both', async () => {
        await h.addFact({
          kind: 'BILLED',
          date: '2026-06-02',
          amountUsd: '10.00',
          clientId: 'c1',
          projectId: 'p1',
        });
        await h.addFact({
          kind: 'BILLED',
          date: '2026-06-02',
          amountUsd: '20.00',
          clientId: 'c1',
          projectId: 'p2',
        });
        await h.addFact({
          kind: 'BILLED',
          date: '2026-06-02',
          amountUsd: '40.00',
          clientId: 'c2',
          projectId: 'p1',
        });
        await h.addFact({
          kind: 'EXPENSE_PAID',
          date: '2026-06-02',
          amountUsd: '5.00',
          projectId: 'p1',
        });
        expect((await h.port.sumByKind(june, { clientId: 'c1' })).BILLED).toBe('30.00');
        expect((await h.port.sumByKind(june, { projectId: 'p1' })).BILLED).toBe('50.00');
        expect((await h.port.sumByKind(june, { projectId: 'p1' })).EXPENSE_PAID).toBe('5.00');
        const both = await h.port.sumByKind(june, { clientId: 'c1', projectId: 'p1' });
        expect(both.BILLED).toBe('10.00');
        expect(both.EXPENSE_PAID).toBe(ZERO);
      });

      it('narrows by tag through the client or the project assignment (DT-170)', async () => {
        await h.tag('t1', { clientIds: ['c1'], projectIds: ['p9'] });
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-02',
          amountUsd: '10.00',
          clientId: 'c1',
          projectId: 'p1',
        });
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-02',
          amountUsd: '20.00',
          clientId: 'c2',
          projectId: 'p9',
        });
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-02',
          amountUsd: '40.00',
          clientId: 'c2',
          projectId: 'p2',
        });
        expect((await h.port.sumByKind(june, { tagId: 't1' })).COLLECTED).toBe('30.00');
        expect((await h.port.sumByKind(june, { tagId: 'unknown' })).COLLECTED).toBe(ZERO);
        const narrowed = await h.port.sumByKind(june, { tagId: 't1', clientId: 'c2' });
        expect(narrowed.COLLECTED).toBe('20.00');
      });

      it('counts a fact once when both its client and its project carry the tag', async () => {
        await h.tag('t1', { clientIds: ['c1'], projectIds: ['p1'] });
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-02',
          amountUsd: '10.00',
          clientId: 'c1',
          projectId: 'p1',
        });
        expect((await h.port.sumByKind(june, { tagId: 't1' })).COLLECTED).toBe('10.00');
      });
    });

    describe('monthlySeries', () => {
      it('returns every month of the range with zeros where there are no facts', async () => {
        await h.addFact({ kind: 'COLLECTED', date: '2026-01-15', amountUsd: '10.00' });
        await h.addFact({ kind: 'COLLECTED', date: '2026-03-15', amountUsd: '30.00' });
        await h.addFact({ kind: 'BILLED', date: '2026-03-16', amountUsd: '5.00' });
        const series = await h.port.monthlySeries({ from: '2026-01-01', to: '2026-03-31' }, [
          'COLLECTED',
          'BILLED',
        ]);
        expect(series).toEqual([
          { month: '2026-01', amounts: { COLLECTED: '10.00', BILLED: ZERO } },
          { month: '2026-02', amounts: { COLLECTED: ZERO, BILLED: ZERO } },
          { month: '2026-03', amounts: { COLLECTED: '30.00', BILLED: '5.00' } },
        ]);
      });

      it('cuts the first and last months at the range dates and crosses a year', async () => {
        await h.addFact({ kind: 'BILLED', date: '2025-12-09', amountUsd: '1.00' });
        await h.addFact({ kind: 'BILLED', date: '2025-12-10', amountUsd: '2.00' });
        await h.addFact({ kind: 'BILLED', date: '2026-01-20', amountUsd: '4.00' });
        await h.addFact({ kind: 'BILLED', date: '2026-01-21', amountUsd: '8.00' });
        const series = await h.port.monthlySeries({ from: '2025-12-10', to: '2026-01-20' }, [
          'BILLED',
        ]);
        expect(series).toEqual([
          { month: '2025-12', amounts: { BILLED: '2.00' } },
          { month: '2026-01', amounts: { BILLED: '4.00' } },
        ]);
      });

      it('applies the filter', async () => {
        await h.addFact({ kind: 'BILLED', date: '2026-06-02', amountUsd: '1.00', clientId: 'c1' });
        await h.addFact({ kind: 'BILLED', date: '2026-06-02', amountUsd: '2.00', clientId: 'c2' });
        const series = await h.port.monthlySeries(june, ['BILLED'], { clientId: 'c2' });
        expect(series).toEqual([{ month: '2026-06', amounts: { BILLED: '2.00' } }]);
      });
    });

    describe('sumBy', () => {
      it('groups by client and project, ascending by key, leaving out facts without the dimension', async () => {
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-02',
          amountUsd: '10.00',
          clientId: 'c2',
          projectId: 'p1',
        });
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-03',
          amountUsd: '5.00',
          clientId: 'c1',
          projectId: 'p1',
        });
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-04',
          amountUsd: '1.00',
          clientId: 'c2',
        });
        await h.addFact({ kind: 'BILLED', date: '2026-06-04', amountUsd: '7.00', clientId: 'c1' });
        expect(await h.port.sumBy('client', june, ['COLLECTED', 'BILLED'])).toEqual([
          { key: 'c1', amounts: { COLLECTED: '5.00', BILLED: '7.00' } },
          { key: 'c2', amounts: { COLLECTED: '11.00', BILLED: ZERO } },
        ]);
        expect(await h.port.sumBy('project', june, ['COLLECTED'])).toEqual([
          { key: 'p1', amounts: { COLLECTED: '15.00' } },
        ]);
      });

      it('groups collections by method and flows by account', async () => {
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-02',
          amountUsd: '10.00',
          methodId: 'm1',
          accountId: 'a1',
        });
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-06-02',
          amountUsd: '4.00',
          methodId: 'm2',
          accountId: 'a1',
        });
        await h.addFact({
          kind: 'EXPENSE_PAID',
          date: '2026-06-03',
          amountUsd: '3.00',
          accountId: 'a1',
        });
        await h.addFact({
          kind: 'TRANSFER_IN',
          date: '2026-06-03',
          amountUsd: '9.00',
          accountId: 'a2',
        });
        expect(await h.port.sumBy('method', june, ['COLLECTED'])).toEqual([
          { key: 'm1', amounts: { COLLECTED: '10.00' } },
          { key: 'm2', amounts: { COLLECTED: '4.00' } },
        ]);
        expect(
          await h.port.sumBy('account', june, ['COLLECTED', 'EXPENSE_PAID', 'TRANSFER_IN']),
        ).toEqual([
          { key: 'a1', amounts: { COLLECTED: '14.00', EXPENSE_PAID: '3.00', TRANSFER_IN: ZERO } },
          { key: 'a2', amounts: { COLLECTED: ZERO, EXPENSE_PAID: ZERO, TRANSFER_IN: '9.00' } },
        ]);
      });

      it('resolves an expense category to its root at read time', async () => {
        await h.addCategory('cat-root');
        await h.addCategory('cat-child', 'cat-root');
        await h.addCategory('cat-leaf', 'cat-child');
        await h.addCategory('cat-other');
        await h.addFact({
          kind: 'EXPENSE_PAID',
          date: '2026-06-02',
          amountUsd: '10.00',
          categoryId: 'cat-leaf',
        });
        await h.addFact({
          kind: 'EXPENSE_PAID',
          date: '2026-06-02',
          amountUsd: '1.00',
          categoryId: 'cat-child',
        });
        await h.addFact({
          kind: 'EXPENSE_PAID',
          date: '2026-06-02',
          amountUsd: '2.00',
          categoryId: 'cat-root',
        });
        await h.addFact({
          kind: 'EXPENSE_PAID',
          date: '2026-06-02',
          amountUsd: '4.00',
          categoryId: 'cat-other',
        });
        expect(await h.port.sumBy('category', june, ['EXPENSE_PAID'])).toEqual([
          { key: 'cat-other', amounts: { EXPENSE_PAID: '4.00' } },
          { key: 'cat-root', amounts: { EXPENSE_PAID: '13.00' } },
        ]);
      });

      it('returns nothing for a range without facts, and honors the filter', async () => {
        expect(await h.port.sumBy('client', june, ['BILLED'])).toEqual([]);
        await h.addFact({
          kind: 'BILLED',
          date: '2026-06-02',
          amountUsd: '3.00',
          clientId: 'c1',
          projectId: 'p1',
        });
        await h.addFact({
          kind: 'BILLED',
          date: '2026-06-02',
          amountUsd: '6.00',
          clientId: 'c2',
          projectId: 'p2',
        });
        expect(await h.port.sumBy('client', june, ['BILLED'], { projectId: 'p2' })).toEqual([
          { key: 'c2', amounts: { BILLED: '6.00' } },
        ]);
      });
    });

    describe('receivableAt and agingAt (DT-125, on dueDate)', () => {
      const billed = (
        invoiceId: string,
        amountUsd: string,
        dueDate: string,
        extra: Partial<SeedFact> = {},
      ): SeedFact => ({
        kind: 'BILLED',
        date: '2026-01-10',
        amountUsd,
        invoiceId,
        clientId: 'c1',
        dueDate,
        ...extra,
      });

      it('is BILLED minus WITHHELD_* minus COLLECTED, as of the close date', async () => {
        await h.addFact(billed('i1', '1000.00', '2026-02-10'));
        await h.addFact({
          kind: 'WITHHELD_IVA',
          date: '2026-01-10',
          amountUsd: '60.00',
          invoiceId: 'i1',
          clientId: 'c1',
        });
        await h.addFact({
          kind: 'WITHHELD_ISLR',
          date: '2026-01-10',
          amountUsd: '40.00',
          invoiceId: 'i1',
          clientId: 'c1',
        });
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-03-01',
          amountUsd: '400.00',
          invoiceId: 'i1',
          clientId: 'c1',
        });
        expect(await h.port.receivableAt('2026-02-28')).toEqual({
          totalUsd: '900.00',
          overdueUsd: '900.00',
        });
        expect(await h.port.receivableAt('2026-03-01')).toEqual({
          totalUsd: '500.00',
          overdueUsd: '500.00',
        });
      });

      it('ignores facts dated after the close, an invoice issued later included', async () => {
        await h.addFact(billed('i1', '100.00', '2026-02-10'));
        await h.addFact(billed('i2', '50.00', '2026-04-10', { date: '2026-03-20' }));
        expect(await h.port.receivableAt('2026-03-01')).toEqual({
          totalUsd: '100.00',
          overdueUsd: '100.00',
        });
      });

      it('treats an invoice as overdue only when its dueDate is before the close', async () => {
        await h.addFact(billed('i1', '100.00', '2026-03-01'));
        await h.addFact(billed('i2', '30.00', '2026-02-28'));
        expect(await h.port.receivableAt('2026-03-01')).toEqual({
          totalUsd: '130.00',
          overdueUsd: '30.00',
        });
      });

      it('leaves out settled invoices and over-collected ones', async () => {
        await h.addFact(billed('i1', '100.00', '2026-02-10'));
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-02-01',
          amountUsd: '100.00',
          invoiceId: 'i1',
          clientId: 'c1',
        });
        await h.addFact(billed('i2', '10.00', '2026-02-10'));
        await h.addFact({
          kind: 'COLLECTED',
          date: '2026-02-01',
          amountUsd: '12.00',
          invoiceId: 'i2',
          clientId: 'c1',
        });
        expect(await h.port.receivableAt('2026-03-01')).toEqual({
          totalUsd: ZERO,
          overdueUsd: ZERO,
        });
      });

      it('is zero without facts, and narrows by client, project and tag', async () => {
        expect(await h.port.receivableAt('2026-03-01')).toEqual({
          totalUsd: ZERO,
          overdueUsd: ZERO,
        });
        await h.tag('t1', { clientIds: ['c2'] });
        await h.addFact(billed('i1', '100.00', '2026-02-10', { projectId: 'p1' }));
        await h.addFact(billed('i2', '30.00', '2026-02-10', { clientId: 'c2', projectId: 'p2' }));
        expect((await h.port.receivableAt('2026-03-01', { clientId: 'c2' })).totalUsd).toBe(
          '30.00',
        );
        expect((await h.port.receivableAt('2026-03-01', { projectId: 'p1' })).totalUsd).toBe(
          '100.00',
        );
        expect((await h.port.receivableAt('2026-03-01', { tagId: 't1' })).totalUsd).toBe('30.00');
      });

      it('buckets balances by days past due on dueDate, per client, largest total first', async () => {
        const close = '2026-06-30';
        await h.addFact(billed('not-due', '1.00', '2026-07-15'));
        await h.addFact(billed('d30', '2.00', '2026-05-31'));
        await h.addFact(billed('d31', '4.00', '2026-05-30'));
        await h.addFact(billed('d60', '8.00', '2026-05-01'));
        await h.addFact(billed('d61', '16.00', '2026-04-30'));
        await h.addFact(billed('d90', '32.00', '2026-04-01'));
        await h.addFact(billed('d91', '64.00', '2026-03-31'));
        await h.addFact(billed('other', '500.00', '2026-06-01', { clientId: 'c0' }));
        const aging = await h.port.agingAt(close);
        expect(aging.rows).toEqual([
          {
            clientId: 'c0',
            buckets: { d0_30: '500.00', d31_60: ZERO, d61_90: ZERO, d90plus: ZERO },
            totalUsd: '500.00',
          },
          {
            clientId: 'c1',
            buckets: { d0_30: '3.00', d31_60: '12.00', d61_90: '48.00', d90plus: '64.00' },
            totalUsd: '127.00',
          },
        ]);
        expect(aging.totals).toEqual({
          d0_30: '503.00',
          d31_60: '12.00',
          d61_90: '48.00',
          d90plus: '64.00',
        });
        expect(aging.totalUsd).toBe('627.00');
        expect((await h.port.receivableAt(close)).totalUsd).toBe(aging.totalUsd);
      });

      it('is empty without open balances', async () => {
        expect(await h.port.agingAt('2026-06-30')).toEqual({
          rows: [],
          totals: { d0_30: ZERO, d31_60: ZERO, d61_90: ZERO, d90plus: ZERO },
          totalUsd: ZERO,
        });
      });
    });

    describe('ivaByRate', () => {
      it('sums IVA facts per rate, rates ascending, within the range and filter', async () => {
        await h.addFact({
          kind: 'IVA',
          date: '2026-06-02',
          amountUsd: '16.00',
          ivaRate: '16.00',
          clientId: 'c1',
        });
        await h.addFact({
          kind: 'IVA',
          date: '2026-06-03',
          amountUsd: '0.10',
          ivaRate: '16.00',
          clientId: 'c1',
        });
        await h.addFact({
          kind: 'IVA',
          date: '2026-06-03',
          amountUsd: '0.20',
          ivaRate: '16.00',
          clientId: 'c2',
        });
        await h.addFact({
          kind: 'IVA',
          date: '2026-06-04',
          amountUsd: '8.00',
          ivaRate: '8.00',
          clientId: 'c1',
        });
        await h.addFact({
          kind: 'IVA',
          date: '2026-07-04',
          amountUsd: '99.00',
          ivaRate: '8.00',
          clientId: 'c1',
        });
        await h.addFact({ kind: 'BILLED', date: '2026-06-04', amountUsd: '99.00', clientId: 'c1' });
        expect(await h.port.ivaByRate(june)).toEqual([
          { ivaRate: '8.00', amountUsd: '8.00' },
          { ivaRate: '16.00', amountUsd: '16.30' },
        ]);
        expect(await h.port.ivaByRate(june, { clientId: 'c2' })).toEqual([
          { ivaRate: '16.00', amountUsd: '0.20' },
        ]);
        expect(await h.port.ivaByRate({ from: '2026-08-01', to: '2026-08-31' })).toEqual([]);
      });
    });
  });
}
