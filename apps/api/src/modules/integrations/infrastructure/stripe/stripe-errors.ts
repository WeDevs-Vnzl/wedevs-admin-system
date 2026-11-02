import Stripe from 'stripe';
import {
  DomainError,
  NotFoundError,
  RateLimitedError,
  ValidationFailedError,
} from '../../../../shared/domain';

/**
 * Translates an SDK failure to a `DomainError` (no SDK type leaves the adapter). The adapter never retries:
 * the caller owns retries, and the idempotency key makes them safe.
 *  - 404 -> NotFound; 429 -> RateLimited; other 4xx -> Validation (the request was refused);
 *  - 401/403 or a missing key -> INTERNAL `misconfigured`; 5xx, timeouts and connection errors -> INTERNAL `unavailable`.
 */
export function mapStripeError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  if (error instanceof Stripe.errors.StripeError) {
    const status = error.statusCode;
    if (error instanceof Stripe.errors.StripeRateLimitError || status === 429)
      return new RateLimitedError();
    if (status === 404) return new NotFoundError();
    if (status === 401 || status === 403) {
      return new DomainError('INTERNAL', { message: 'integrations.stripe.misconfigured' });
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return new ValidationFailedError({ message: 'integrations.stripe.rejected' });
    }
  }
  return new DomainError('INTERNAL', { message: 'integrations.stripe.unavailable' });
}

export function isStripeSignatureError(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeSignatureVerificationError;
}
