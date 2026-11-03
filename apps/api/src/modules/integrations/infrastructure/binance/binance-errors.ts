import { DomainError } from '../../../../shared/domain/domain-error';

/**
 * Why a Binance call failed. `RATE_LIMITED` (HTTP 429 or 418) and `UNAVAILABLE` (5xx, transport, timeout) are worth
 * retrying later; `REJECTED` (other 4xx: bad key, bad signature, bad request) and `MALFORMED` (a 2xx body that
 * is not what the port promises) are not.
 */
export type BinanceFailureReason = 'RATE_LIMITED' | 'UNAVAILABLE' | 'REJECTED' | 'MALFORMED';

/**
 * Typed failure of the Binance adapter. Carries no response body, URL, key or signature: the message is an i18n
 * key. The adapter never retries; the job that calls it decides (DT-184).
 */
export class BinanceExchangeError extends DomainError {
  constructor(
    readonly reason: BinanceFailureReason,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
    readonly providerCode: number | null = null,
  ) {
    super(reason === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'INTERNAL', {
      message: `integrations.errors.binance.${reason}`,
    });
  }
}
