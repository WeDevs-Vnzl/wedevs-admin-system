import { describe, expect, it } from 'vitest';
import { NoFinanceYetProjectBilling } from './no-finance-yet.project-billing.adapter';

describe('NoFinanceYetProjectBilling (Q-BE2-1)', () => {
  const billing = new NoFinanceYetProjectBilling();

  it('answers "no plan, nothing active" for any project', async () => {
    expect(await billing.hasActiveBilling()).toBe(false);
    expect(await billing.hasBillingPlan()).toBe(false);
    expect(await billing.hasActiveRecurringCharge()).toBe(false);
  });

  it('cancels nothing whatever the options', async () => {
    expect(await billing.cancelForProject()).toEqual({ installments: 0, recurringCharges: 0 });
  });
});
