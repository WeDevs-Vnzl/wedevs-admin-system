export const PROJECT_BILLING = Symbol('PROJECT_BILLING');

/** What cancelling a project asks the billing side to do (HU-08 CA3). */
export interface ProjectCancelOptions {
  readonly cancelPendingInstallments: boolean;
  readonly finishRecurringCharges: boolean;
}

/** What the billing side actually cancelled, recorded in the status entry's metadata. */
export interface ProjectCancelResult {
  readonly installments: number;
  readonly recurringCharges: number;
}

/**
 * Commercial's own narrow view of a project's billing (Q-BE2-1): billing plan, installments, recurring
 * charges and invoices live in `finance` (BE-3). BE-2 binds the neutral adapter ("no plan, nothing
 * active, nothing cancelled"); BE-3 rebinds it to finance's exported application API. Methods that
 * write run inside the caller's unit of work.
 */
export interface ProjectBillingPort {
  /** Open installments, a live recurring charge or an issued invoice: archiving needs `confirm`. */
  hasActiveBilling(projectId: string): Promise<boolean>;
  hasBillingPlan(projectId: string): Promise<boolean>;
  hasActiveRecurringCharge(projectId: string): Promise<boolean>;
  /** Cancels pending installments and finishes recurring charges as chosen; joins the caller's UoW. */
  cancelForProject(projectId: string, options: ProjectCancelOptions): Promise<ProjectCancelResult>;
}
