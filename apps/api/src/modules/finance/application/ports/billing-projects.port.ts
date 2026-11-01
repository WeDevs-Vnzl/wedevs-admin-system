export const BILLING_PROJECTS = Symbol('BILLING_PROJECTS');

/** A live project as billing needs it: the clients to lock and to project, and its label for activity. */
export interface BillingProject {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly clientIds: readonly string[];
}

/**
 * Billing's view of commercial's exported `FinanceLookups` (boundary rule e, C14): a project id sent by a
 * caller is never trusted without this lookup. `null` for an unknown or archived project. Joins the
 * caller's unit of work when one is open.
 */
export interface BillingProjectsPort {
  liveProject(id: string): Promise<BillingProject | null>;
}
