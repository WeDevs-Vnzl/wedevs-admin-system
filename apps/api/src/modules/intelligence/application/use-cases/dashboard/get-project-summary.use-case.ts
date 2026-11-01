import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { MoneyString } from '../../../../../shared/domain/money';
import type { DashboardPanelsReadPort } from '../../ports/dashboard-panels-read.port';

/** PRD §8.4.4: every figure is USD from the stored snapshots (C16). */
export interface ProjectSummaryOutput {
  readonly projectId: string;
  readonly currency: 'USD';
  /** Contracted amount plus adjustments, never below zero (the stored column). */
  readonly contractedValue: MoneyString;
  readonly invoiced: MoneyString;
  readonly collected: MoneyString;
  /** Only for fixed-price and mixed plans, else `null`. */
  readonly toInvoice: MoneyString | null;
  readonly receivable: MoneyString;
  readonly monthlyRecurring: MoneyString;
  readonly allocatedExpenses: MoneyString;
  readonly margin: MoneyString;
  /** Margin ÷ collected as a percentage; `null` while nothing is collected. */
  readonly marginPercent: MoneyString | null;
}

/**
 * `GET /projects/{id}/summary` (PRD §8.4.4, DT-113): the stored `ProjectMetrics`. `FORBIDDEN` without
 * `canSeeFinancials`; unknown is `NOT_FOUND` and archived only for the trash roles (C14, C19).
 */
export class GetProjectSummary {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly panels: DashboardPanelsReadPort,
  ) {}

  async execute(user: CurrentUser, input: { readonly id: string }): Promise<ProjectSummaryOutput> {
    if (!this.authorization.canSeeFinancials(user)) throw new ForbiddenError();
    assertCan(this.authorization, user, 'read', 'project');
    const record = await this.panels.projectMetrics(input.id);
    if (!record || (record.archived && !this.authorization.can(user, 'restore', 'trash'))) {
      throw new NotFoundError();
    }
    const m = record.metrics;
    const billsContract = record.model === 'PRECIO_FIJO' || record.model === 'MIXTO';
    return {
      projectId: m.projectId,
      currency: 'USD',
      contractedValue: m.contractedUsd,
      invoiced: m.invoicedUsd,
      collected: m.collectedUsd,
      toInvoice: billsContract ? m.toInvoiceUsd : null,
      receivable: m.receivableUsd,
      monthlyRecurring: m.monthlyRecurringUsd,
      allocatedExpenses: m.expensesUsd,
      margin: m.marginUsd,
      marginPercent: m.marginPercent,
    };
  }
}
