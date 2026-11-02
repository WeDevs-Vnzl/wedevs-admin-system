import { NotFoundError } from '../../../../shared/domain';

/** DT-110 token: `true` when `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are both set (choice 3, DT-193). */
export const STRIPE_ENABLED = Symbol('STRIPE_ENABLED');

/** A disabled integration answers 404 `NOT_FOUND`, the same as a route that does not exist. */
export function assertStripeEnabled(enabled: boolean): void {
  if (!enabled) throw new NotFoundError();
}
