import type { CurrentUser } from '../../../../../shared/application/current-user';

export const MAPPED_ACCOUNT_CURRENCY = Symbol('MAPPED_ACCOUNT_CURRENCY');

/**
 * The currency of the account the Stripe mapping points at, read from finance (DT-110). `null` when the account
 * does not exist or is inactive, which a payment link treats like "no mapping": the money would have nowhere to land.
 */
export interface MappedAccountCurrencyPort {
  currencyOf(actor: CurrentUser, accountId: string): Promise<string | null>;
}
