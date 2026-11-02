import { isZeroMoney, toDecimal } from '../../../src/shared/domain/money';
import { daysBetween, type DateOnly } from '../../../src/shared/domain/business-date';
import {
  addMoney,
  compareMoney,
  subMoney,
  sumMoney,
  type MoneyString,
} from '../../../src/shared/domain/money';
import type { FinanceFactKind } from '../../../src/modules/finance/application/kpi-api';
import {
  FACT_KINDS,
  type AgingBuckets,
  type FactDimension,
  type FactFilter,
  type FactGroupRow,
  type FinanceFactsReadPort,
  type IvaByRateRow,
  type KindAmounts,
  type MonthlyFacts,
  type ReceivableAt,
  type ReceivablesAging,
} from '../../../src/modules/intelligence/application/ports/finance-facts-read.port';
import {
  monthOf,
  monthsOf,
  type DateRange,
} from '../../../src/modules/intelligence/domain/report-range';

export type SeedFact = {
  kind: FinanceFactKind;
  date: DateOnly;
  amountUsd: MoneyString;
  clientId?: string | null;
  projectId?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  methodId?: string | null;
  invoiceId?: string | null;
  ivaRate?: MoneyString | null;
  dueDate?: DateOnly | null;
};

const ZERO = '0.00';
const WITHHELD: readonly FinanceFactKind[] = ['WITHHELD_IVA', 'WITHHELD_ISLR', 'WITHHELD_OTHER'];
const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const emptyBuckets = (): AgingBuckets => ({
  d0_30: ZERO,
  d31_60: ZERO,
  d61_90: ZERO,
  d90plus: ZERO,
});

function bucketOf(daysPastDue: number): keyof AgingBuckets {
  if (daysPastDue <= 30) return 'd0_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  return 'd90plus';
}

/** Fake `FinanceFactsReadPort` over seeded facts: the same rules as the SQL adapter, in memory. */
export class InMemoryFinanceFactsRead implements FinanceFactsReadPort {
  private readonly facts: SeedFact[] = [];
  private readonly tagged = new Map<string, { clients: Set<string>; projects: Set<string> }>();
  private readonly parents = new Map<string, string | null>();

  addFact(fact: SeedFact): void {
    this.facts.push({ ...fact });
  }

  /** `TagAssignment` rows: the tag sits on these clients and projects. */
  tag(tagId: string, assigned: { clientIds?: string[]; projectIds?: string[] }): void {
    this.tagged.set(tagId, {
      clients: new Set(assigned.clientIds ?? []),
      projects: new Set(assigned.projectIds ?? []),
    });
  }

  addCategory(id: string, parentId: string | null = null): void {
    this.parents.set(id, parentId);
  }

  private matches(fact: SeedFact, filter: FactFilter | undefined): boolean {
    if (filter?.clientId && fact.clientId !== filter.clientId) return false;
    if (filter?.projectId && fact.projectId !== filter.projectId) return false;
    if (filter?.tagId) {
      const tag = this.tagged.get(filter.tagId);
      const onClient = !!fact.clientId && !!tag?.clients.has(fact.clientId);
      const onProject = !!fact.projectId && !!tag?.projects.has(fact.projectId);
      if (!onClient && !onProject) return false;
    }
    return true;
  }

  private inRange(range: DateRange, filter?: FactFilter): SeedFact[] {
    return this.facts.filter(
      (fact) => fact.date >= range.from && fact.date <= range.to && this.matches(fact, filter),
    );
  }

  private root(categoryId: string): string {
    let current = categoryId;
    for (let parent = this.parents.get(current); parent; parent = this.parents.get(current)) {
      current = parent;
    }
    return current;
  }

  async sumByKind(range: DateRange, filter?: FactFilter): Promise<KindAmounts> {
    const rows = this.inRange(range, filter);
    return Object.fromEntries(
      FACT_KINDS.map((kind) => [
        kind,
        sumMoney(rows.filter((fact) => fact.kind === kind).map((fact) => fact.amountUsd)),
      ]),
    ) as KindAmounts;
  }

  async monthlySeries<K extends FinanceFactKind>(
    range: DateRange,
    kinds: readonly K[],
    filter?: FactFilter,
  ): Promise<MonthlyFacts<K>[]> {
    const rows = this.inRange(range, filter);
    return monthsOf(range).map((month) => ({
      month,
      amounts: Object.fromEntries(
        kinds.map((kind) => [
          kind,
          sumMoney(
            rows
              .filter((fact) => fact.kind === kind && monthOf(fact.date) === month)
              .map((fact) => fact.amountUsd),
          ),
        ]),
      ) as KindAmounts<K>,
    }));
  }

  async sumBy<K extends FinanceFactKind>(
    dimension: FactDimension,
    range: DateRange,
    kinds: readonly K[],
    filter?: FactFilter,
  ): Promise<FactGroupRow<K>[]> {
    const groups = new Map<string, SeedFact[]>();
    for (const fact of this.inRange(range, filter)) {
      if (!kinds.includes(fact.kind as K)) continue;
      const raw = {
        client: fact.clientId,
        project: fact.projectId,
        account: fact.accountId,
        method: fact.methodId,
        category: fact.categoryId ? this.root(fact.categoryId) : null,
      }[dimension];
      if (!raw) continue;
      groups.set(raw, [...(groups.get(raw) ?? []), fact]);
    }
    return [...groups]
      .sort(([a], [b]) => byteOrder(a, b))
      .map(([key, rows]) => ({
        key,
        amounts: Object.fromEntries(
          kinds.map((kind) => [
            kind,
            sumMoney(rows.filter((fact) => fact.kind === kind).map((fact) => fact.amountUsd)),
          ]),
        ) as KindAmounts<K>,
      }));
  }

  /**
   * Open balance of each invoice at `close`, with its client and due date. Withholdings carry no project, so a
   * filtered read takes the share of the invoice's withholding that matches its filtered billed amount.
   */
  private balances(close: DateOnly, filter?: FactFilter) {
    const byInvoice = new Map<
      string,
      {
        clientId: string | null;
        dueDate: DateOnly | null;
        billed: MoneyString;
        collected: MoneyString;
      }
    >();
    const whole = new Map<string, { billed: MoneyString; withheld: MoneyString }>();
    for (const fact of this.facts) {
      if (!fact.invoiceId || fact.date > close) continue;
      const totals = whole.get(fact.invoiceId) ?? { billed: ZERO, withheld: ZERO };
      if (fact.kind === 'BILLED') totals.billed = addMoney(totals.billed, fact.amountUsd);
      if (WITHHELD.includes(fact.kind)) totals.withheld = addMoney(totals.withheld, fact.amountUsd);
      whole.set(fact.invoiceId, totals);
      if (!this.matches(fact, filter)) continue;
      const current = byInvoice.get(fact.invoiceId) ?? {
        clientId: null,
        dueDate: null,
        billed: ZERO,
        collected: ZERO,
      };
      if (fact.kind === 'BILLED') {
        current.billed = addMoney(current.billed, fact.amountUsd);
        current.dueDate = fact.dueDate ?? current.dueDate;
        current.clientId = fact.clientId ?? current.clientId;
      } else if (fact.kind === 'COLLECTED') {
        current.collected = addMoney(current.collected, fact.amountUsd);
      }
      byInvoice.set(fact.invoiceId, current);
    }
    return [...byInvoice.entries()]
      .map(([invoiceId, row]) => {
        const totals = whole.get(invoiceId) ?? { billed: ZERO, withheld: ZERO };
        const share = isZeroMoney(totals.billed)
          ? ZERO
          : toDecimal(totals.withheld).mul(row.billed).div(totals.billed).toFixed(2);
        return { ...row, balance: subMoney(subMoney(row.billed, row.collected), share) };
      })
      .filter((row) => row.dueDate !== null && compareMoney(row.balance, ZERO) > 0);
  }

  async receivableAt(close: DateOnly, filter?: FactFilter): Promise<ReceivableAt> {
    const rows = this.balances(close, filter);
    return {
      totalUsd: sumMoney(rows.map((row) => row.balance)),
      overdueUsd: sumMoney(
        rows.filter((row) => (row.dueDate as DateOnly) < close).map((row) => row.balance),
      ),
    };
  }

  async agingAt(close: DateOnly, filter?: FactFilter): Promise<ReceivablesAging> {
    const totals = emptyBuckets();
    const byClient = new Map<string, AgingBuckets>();
    for (const row of this.balances(close, filter)) {
      if (!row.clientId) continue;
      const bucket = bucketOf(daysBetween(row.dueDate as DateOnly, close));
      const buckets = byClient.get(row.clientId) ?? emptyBuckets();
      buckets[bucket] = addMoney(buckets[bucket], row.balance);
      totals[bucket] = addMoney(totals[bucket], row.balance);
      byClient.set(row.clientId, buckets);
    }
    const rows = [...byClient]
      .map(([clientId, buckets]) => ({
        clientId,
        buckets,
        totalUsd: sumMoney(Object.values(buckets)),
      }))
      .sort((a, b) => compareMoney(b.totalUsd, a.totalUsd) || byteOrder(a.clientId, b.clientId));
    return { rows, totals, totalUsd: sumMoney(Object.values(totals)) };
  }

  async ivaByRate(range: DateRange, filter?: FactFilter): Promise<IvaByRateRow[]> {
    const rates = new Map<string, MoneyString[]>();
    for (const fact of this.inRange(range, filter)) {
      if (fact.kind !== 'IVA' || fact.ivaRate == null) continue;
      rates.set(fact.ivaRate, [...(rates.get(fact.ivaRate) ?? []), fact.amountUsd]);
    }
    return [...rates]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([ivaRate, amounts]) => ({ ivaRate, amountUsd: sumMoney(amounts) }));
  }
}
