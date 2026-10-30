import type { ProjectStatus } from '../../../shared/domain/enums';

/**
 * Project status machine (PRD §8.3, HU-08). Ported from `canTransitionProject` in
 * `fe/src/lib/validators/projects.ts`. `CANCELADO` is reachable from any other status and is final.
 */
export const PROJECT_STATUS_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> =
  {
    PROPUESTA: ['EN_CURSO', 'CANCELADO'],
    EN_CURSO: ['PAUSADO', 'ENTREGADO', 'CANCELADO'],
    PAUSADO: ['EN_CURSO', 'CANCELADO'],
    ENTREGADO: ['MANTENIMIENTO', 'CANCELADO'],
    MANTENIMIENTO: ['CANCELADO'],
    CANCELADO: [],
  };

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[from].includes(to);
}

/** Non-blocking suggestions a status change returns as data (PRD §8.3). */
export const PROJECT_STATUS_HINT_VALUES = ['NO_BILLING_PLAN', 'SUGGEST_RECURRING_CHARGE'] as const;
export type ProjectStatusHint = (typeof PROJECT_STATUS_HINT_VALUES)[number];

/** What the billing side knows about a project, as far as the hints need it. */
export interface ProjectBillingFacts {
  readonly hasBillingPlan: boolean;
  readonly hasActiveRecurringCharge: boolean;
}

/**
 * Hints for the status the project has just entered: `EN_CURSO` without a billing plan warns, and
 * `MANTENIMIENTO` without an active recurring charge suggests creating one. Neither blocks.
 */
export function projectStatusHints(
  status: ProjectStatus,
  facts: ProjectBillingFacts,
): ProjectStatusHint[] {
  const hints: ProjectStatusHint[] = [];
  if (status === 'EN_CURSO' && !facts.hasBillingPlan) hints.push('NO_BILLING_PLAN');
  if (status === 'MANTENIMIENTO' && !facts.hasActiveRecurringCharge) {
    hints.push('SUGGEST_RECURRING_CHARGE');
  }
  return hints;
}
