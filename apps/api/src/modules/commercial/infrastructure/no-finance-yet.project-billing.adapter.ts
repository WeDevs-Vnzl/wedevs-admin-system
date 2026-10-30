import { Injectable } from '@nestjs/common';
import type {
  ProjectBillingPort,
  ProjectCancelResult,
} from '../application/ports/project-billing.port';

/**
 * Neutral `ProjectBillingPort` for BE-2 (Q-BE2-1): billing plans, installments, recurring charges and
 * invoices belong to `finance` (BE-3), and no write path for those tables exists yet, so "no plan,
 * nothing active, nothing cancelled" is the truth. BE-3 rebinds the port to finance's application API.
 */
@Injectable()
export class NoFinanceYetProjectBilling implements ProjectBillingPort {
  hasActiveBilling(): Promise<boolean> {
    return Promise.resolve(false);
  }

  hasBillingPlan(): Promise<boolean> {
    return Promise.resolve(false);
  }

  hasActiveRecurringCharge(): Promise<boolean> {
    return Promise.resolve(false);
  }

  cancelForProject(): Promise<ProjectCancelResult> {
    return Promise.resolve({ installments: 0, recurringCharges: 0 });
  }
}
