import { describe, expect, it } from 'vitest';
import { PROJECT_STATUS_VALUES } from '../../../shared/domain/enums';
import {
  canTransitionProject,
  PROJECT_STATUS_TRANSITIONS,
  projectStatusHints,
} from './project-status';

describe('canTransitionProject', () => {
  it('matches the PRD §8.3 diagram, pair by pair', () => {
    expect(PROJECT_STATUS_TRANSITIONS).toEqual({
      PROPUESTA: ['EN_CURSO', 'CANCELADO'],
      EN_CURSO: ['PAUSADO', 'ENTREGADO', 'CANCELADO'],
      PAUSADO: ['EN_CURSO', 'CANCELADO'],
      ENTREGADO: ['MANTENIMIENTO', 'CANCELADO'],
      MANTENIMIENTO: ['CANCELADO'],
      CANCELADO: [],
    });
  });

  it('allows exactly the listed pairs, never staying in place', () => {
    for (const from of PROJECT_STATUS_VALUES) {
      for (const to of PROJECT_STATUS_VALUES) {
        expect(canTransitionProject(from, to)).toBe(PROJECT_STATUS_TRANSITIONS[from].includes(to));
      }
      expect(canTransitionProject(from, from)).toBe(false);
    }
  });

  it('reaches CANCELADO from every other status and leaves it from none', () => {
    for (const from of PROJECT_STATUS_VALUES.filter((s) => s !== 'CANCELADO')) {
      expect(canTransitionProject(from, 'CANCELADO')).toBe(true);
    }
    expect(PROJECT_STATUS_TRANSITIONS.CANCELADO).toHaveLength(0);
  });
});

describe('projectStatusHints', () => {
  const none = { hasBillingPlan: false, hasActiveRecurringCharge: false };

  it('hints EN_CURSO without a billing plan and MANTENIMIENTO without a recurring charge', () => {
    expect(projectStatusHints('EN_CURSO', none)).toEqual(['NO_BILLING_PLAN']);
    expect(projectStatusHints('MANTENIMIENTO', none)).toEqual(['SUGGEST_RECURRING_CHARGE']);
  });

  it('stays quiet when the plan or the charge exists and for the other statuses', () => {
    expect(projectStatusHints('EN_CURSO', { ...none, hasBillingPlan: true })).toEqual([]);
    expect(
      projectStatusHints('MANTENIMIENTO', { ...none, hasActiveRecurringCharge: true }),
    ).toEqual([]);
    expect(projectStatusHints('PAUSADO', none)).toEqual([]);
    expect(projectStatusHints('ENTREGADO', none)).toEqual([]);
  });
});
