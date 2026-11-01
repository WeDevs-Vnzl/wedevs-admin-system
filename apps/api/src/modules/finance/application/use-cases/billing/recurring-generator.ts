import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import type {
  BillingRepository,
  NewInstallment,
  RecurringChargeRecord,
} from '../../ports/billing.repository.port';
import { periodsToGenerate } from './billing-support';

/**
 * Creates the installments of one charge that are due by `asOf` (HU-10 CA1–CA3). The caller holds the locks of
 * the project and of the charge. The insert skips a `(recurringChargeId, periodStart)` that already exists, so
 * the periods it returns are exactly the ones this call created, never one created by someone else.
 */
export class RecurringGenerator {
  constructor(
    private readonly repository: BillingRepository,
    private readonly ids: IdGeneratorPort,
  ) {}

  async generate(
    charge: RecurringChargeRecord,
    asOf: DateOnly,
    at: Date,
    options: { ignoreStatus?: boolean } = {},
  ): Promise<DateOnly[]> {
    const existing = await this.repository.periodStartsOf(charge.id);
    const periods = periodsToGenerate(charge, existing, asOf, options);
    if (periods.length === 0) return [];

    const plan = await this.repository.findPlan(charge.projectId);
    let order = (await this.repository.maxInstallmentOrder(charge.projectId)) + 1;
    const rows: NewInstallment[] = periods.map((period) => ({
      id: this.ids.next(),
      projectId: charge.projectId,
      billingPlanId: plan?.id ?? null,
      recurringChargeId: charge.id,
      kind: 'RECURRENTE',
      label: `${charge.label} · ${period.periodStart}`,
      amount: charge.amount,
      currency: charge.currency,
      percentage: null,
      dueDate: period.periodStart,
      trigger: null,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      order: order++,
    }));
    const created = (await this.repository.insertGeneratedInstallments(rows)).sort();
    const last = created.at(-1);
    if (
      last !== undefined &&
      (!charge.lastGeneratedPeriodStart || last > charge.lastGeneratedPeriodStart)
    ) {
      await this.repository.updateCharge(charge.id, { lastGeneratedPeriodStart: last }, at);
    }
    return created;
  }
}
