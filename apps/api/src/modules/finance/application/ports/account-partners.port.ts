export const ACCOUNT_PARTNERS = Symbol('ACCOUNT_PARTNERS');

export interface AccountPartner {
  readonly id: string;
  readonly name: string;
}

/**
 * The users who can be the partner behind a contribution or withdrawal (PRD §8.7). The adapter answers
 * from `commercial`'s exported lookups (existence) and from a read-only list of active users.
 */
export interface AccountPartnersPort {
  /** `null` for an unknown or archived user. */
  find(userId: string): Promise<AccountPartner | null>;
  list(): Promise<AccountPartner[]>;
}
