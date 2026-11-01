import type {
  ProjectBillingPort,
  ProjectCancelOptions,
  ProjectCancelResult,
} from '../../../../src/modules/commercial/application/ports/project-billing.port';

/** Billing port the tests drive: which projects have billing, a plan or a recurring charge. */
export class FakeProjectBilling implements ProjectBillingPort {
  readonly activeBilling = new Set<string>();
  readonly plans = new Set<string>();
  readonly recurring = new Set<string>();
  /** What the next `cancelForProject` reports as cancelled. */
  cancelResult: ProjectCancelResult = { installments: 0, recurringCharges: 0 };
  readonly cancelCalls: { projectId: string; options: ProjectCancelOptions }[] = [];

  async hasActiveBilling(projectId: string): Promise<boolean> {
    return this.activeBilling.has(projectId);
  }

  async hasBillingPlan(projectId: string): Promise<boolean> {
    return this.plans.has(projectId);
  }

  async hasActiveRecurringCharge(projectId: string): Promise<boolean> {
    return this.recurring.has(projectId);
  }

  async cancelForProject(
    projectId: string,
    options: ProjectCancelOptions,
  ): Promise<ProjectCancelResult> {
    this.cancelCalls.push({ projectId, options });
    return this.cancelResult;
  }
}
