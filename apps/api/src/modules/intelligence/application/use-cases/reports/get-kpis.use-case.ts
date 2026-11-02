import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { ExchangeRatePort } from '../../../../finance/application/ports/exchange-rate.port';
import { changePercent } from '../../../domain/report-range';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import type { LabelKind, ReportInputsReadPort } from '../../ports/report-inputs-read.port';
import { KPI_ID_VALUES, KPI_UNITS } from './kpi-catalog';
import { kpiValue, type KpiValue } from './kpi-engine';
import { loadKpiData } from './kpi-inputs';
import type { KpiOutput, KpisOutput } from './kpi-types';
import { resolveReportFilter, type ReportFilterInput } from './report-support';
import { monthOf } from '../../../domain/report-range';

type Labelled = Extract<LabelKind, 'CLIENT' | 'PROJECT' | 'TECHNOLOGY'>;

/**
 * `GET /reports/kpis` (PRD §8.13.2, HU-31): the 18 KPI cards of the range, each with its value, the previous
 * period's, the change and a 12-month sparkline. Owner and Admin only (`read report`). The reads are
 * constant in number whatever the cards (C17: the formulas are the finance domain's, not repeated here).
 */
export class GetKpis {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly facts: FinanceFactsReadPort,
    private readonly inputs: ReportInputsReadPort,
    private readonly rates: ExchangeRatePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: ReportFilterInput = {}): Promise<KpisOutput> {
    assertCan(this.authorization, actor, 'read', 'report');
    const { range, scope, today } = await resolveReportFilter(this.inputs, this.clock, input);
    const data = await loadKpiData(
      { facts: this.facts, inputs: this.inputs, rates: this.rates },
      range,
      scope,
      today,
    );

    const cards = KPI_ID_VALUES.map((id): Omit<KpiOutput, 'breakdown'> & { raw: KpiValue } => {
      const raw = kpiValue(id, data.range, data);
      const previousValue = kpiValue(id, data.previous, data).value;
      const sparkline = data.months.flatMap((month) => {
        const value = kpiValue(id, month, data).value;
        return value === null ? [] : [{ period: monthOf(month.window.from), value }];
      });
      return {
        id,
        unit: KPI_UNITS[id],
        value: raw.value,
        previousValue,
        changePercent: changePercent(raw.value, previousValue),
        sparkline,
        raw,
      };
    });

    const labels = await this.labelsFor(cards.map((card) => card.raw));
    return {
      range: { dateFrom: range.from, dateTo: range.to },
      previousRange: { dateFrom: data.previous.window.from, dateTo: data.previous.window.to },
      kpis: cards.map(({ raw, ...card }) => ({
        ...card,
        ...(raw.breakdown && {
          breakdown: raw.breakdown.map((row) => {
            const label = raw.labelKind
              ? (labels.get(raw.labelKind)?.get(row.key) ?? row.key)
              : undefined;
            return label === undefined ? row : { ...row, label };
          }),
        }),
      })),
    };
  }

  /** One label read per kind the breakdowns name. */
  private async labelsFor(
    values: readonly KpiValue[],
  ): Promise<Map<Labelled, Map<string, string>>> {
    const keys = new Map<Labelled, Set<string>>();
    for (const value of values) {
      if (!value.labelKind || !value.breakdown) continue;
      const set = keys.get(value.labelKind) ?? new Set<string>();
      for (const row of value.breakdown) set.add(row.key);
      keys.set(value.labelKind, set);
    }
    const out = new Map<Labelled, Map<string, string>>();
    for (const [kind, set] of keys) {
      const rows = await this.inputs.labels(kind, [...set]);
      out.set(kind, new Map(rows.map((row) => [row.id, row.label])));
    }
    return out;
  }
}
